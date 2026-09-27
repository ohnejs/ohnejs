import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { createHash } from 'node:crypto';
import { after, describe, it } from 'node:test';

import type { UploadSession } from '../../../src/uploads/uploads/types.ts';

import { isOhneError } from '../../../src/ohne/error/ohne-error.ts';
import { HTTPError } from '../../../src/ohne/http/http-error.ts';
import { translate } from '../../../src/ohne/http/translate.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { isValidationError } from '../../../src/ohne/query/write/errors.ts';
import { drainJournal } from '../../../src/uploads/storage/journal.ts';
import { sessionTemp, withSessionLock } from '../../../src/uploads/uploads/_session.ts';
import { abortUploadSession } from '../../../src/uploads/uploads/abort-upload-session.ts';
import { completeUploadSession } from '../../../src/uploads/uploads/complete-upload-session.ts';
import { createUploadSession } from '../../../src/uploads/uploads/create-upload-session.ts';
import { deleteUpload } from '../../../src/uploads/uploads/delete-upload.ts';
import { putUpload } from '../../../src/uploads/uploads/put-upload.ts';
import { writeUploadChunk } from '../../../src/uploads/uploads/write-upload-chunk.ts';
import { bytes, png, storage, stream, text } from '../_fixture.ts';

const LAYER = '/uploads-sessions-complete';
useLayers().add({ path: LAYER, input: { uploads: { chunkSize: 32 } } });
after(() => useLayers().remove(LAYER));

const LORE = bytes('Ironforge was carved from the heart of Dun Morogh by the Bronzebeard clan.');

const MARKUP =
  '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 12" onload="x()">' +
  '<script>alert(1)</script><rect width="1" height="1"/></svg>';

/**
 * A JPEG of `size` bytes whose frame header sits at `frame`, behind one comment segment.
 */
function jpeg(width: number, height: number, frame: number, size: number): Uint8Array {
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out.set([0xff, 0xd8, 0xff, 0xfe]);
  view.setUint16(4, frame - 4);
  out.set([0xff, 0xc0, 0x00, 0x11, 0x08], frame);
  view.setUint16(frame + 5, height);
  view.setUint16(frame + 7, width);
  return out;
}

/**
 * The hex SHA-256 of `source`, as `node:crypto` computes it.
 */
function sha256(source: Uint8Array): string {
  return createHash('sha256').update(source).digest('hex');
}

/**
 * The session row `uuid`, `undefined` once it is gone.
 */
function row(uuid: string): Promise<Record<string, unknown> | undefined> {
  return queryUntyped('UploadsSessions').unscoped().where({ UUID: uuid }).findFirst();
}

/**
 * Sets fields of the session row `uuid` directly, as a crash, a rival, or the clock would leave them.
 */
function tamper(uuid: string, fields: Record<string, unknown>): Promise<unknown> {
  return queryUntyped('UploadsSessions').unscoped().where({ UUID: uuid }).updateOrThrow(fields);
}

/**
 * Opens a session for `content` at `directory`/`name` and sends its chunks up to `until`.
 */
async function upload(
  directory: string,
  name: string,
  content: Uint8Array,
  until = content.byteLength,
): Promise<UploadSession> {
  let session = await createUploadSession({ directory, name, size: content.byteLength });
  while (session.offset < until) {
    const { offset, chunkSize } = session;
    const chunk = { offset, bytes: content.subarray(offset, offset + chunkSize) };
    session = await writeUploadChunk(session.UUID, chunk);
  }
  return session;
}

/**
 * Seals the parts of the session `uuid` in storage, leaving its row as a crash right after would.
 */
async function sealBehindRow(uuid: string): Promise<void> {
  const { token, receipts } = (await row(uuid))!;
  await storage.parts!.complete(sessionTemp(uuid), token as string, JSON.parse(receipts as string));
}

/**
 * The `HTTPError` `run` rejects with.
 */
async function refusal(run: () => Promise<unknown>): Promise<HTTPError> {
  let caught: unknown;
  await rejects(run, (error: unknown) => {
    caught = error;
    return error instanceof HTTPError;
  });
  return caught as HTTPError;
}

/**
 * The field errors `run` rejects with.
 */
async function failure(run: () => Promise<unknown>): Promise<Record<string, unknown>> {
  let caught: unknown;
  await rejects(run, (error: unknown) => {
    caught = error;
    return isValidationError(error);
  });
  return (caught as { errors: Record<string, unknown> }).errors;
}

/**
 * The pending journal entries, in `sequence` order.
 */
async function pending(): Promise<Record<string, unknown>[]> {
  const entries = await queryUntyped('UploadsJournal').orderBy('sequence').findMany();
  return entries.map(({ op, from, to }) => ({ op, from, to }));
}

describe('completeUploadSession', () => {
  it('answers a 409 with the session while bytes are missing', async () => {
    const session = await upload('ironforge', 'missing.txt', LORE, 32);

    const error = await refusal(() => completeUploadSession(session.UUID));

    strictEqual(error.status, 409);
    deepStrictEqual(error.data, session);
    ok(await row(session.UUID));
  });

  it('lands the record putUpload lands for the same bytes, suffixed past it', async () => {
    const image = png(2, 3);
    const whole = await putUpload({
      directory: 'Ironforge',
      name: 'Anvil.PNG',
      body: stream(image),
    });
    const session = await upload('Ironforge', 'Anvil.PNG', image);

    const { record, created } = await completeUploadSession(session.UUID);

    strictEqual(created, true);
    strictEqual(record.path, 'ironforge/anvil-2.png');
    strictEqual(record.url, '/uploads/ironforge/anvil-2.png');
    const facts = ({
      kind,
      type,
      size,
      hash,
      width,
      height,
      private: locked,
      author,
    }: typeof record) => ({ kind, type, size, hash, width, height, locked, author });
    deepStrictEqual(facts(record), facts(whole));
    strictEqual(record.hash, sha256(image));
    deepStrictEqual(storage.objects.get('ironforge/anvil-2.png'), image);
    strictEqual(storage.objects.has(sessionTemp(session.UUID)), false);
    strictEqual((await row(session.UUID))?.upload, record.UUID);
    deepStrictEqual(await pending(), []);
  });

  it('measures an image by its first chunk at the smallest chunk size, as putUpload does', async () => {
    useLayers().add({
      path: '/uploads-sessions-complete-floor',
      input: { uploads: { chunkSize: '64kb' } },
    });
    try {
      const image = jpeg(640, 480, 60_000, 70_000);
      const whole = await putUpload({
        directory: 'ironforge',
        name: 'deep.jpg',
        body: stream(image, 4096),
      });
      const session = await upload('ironforge', 'deep.jpg', image, 65_536);
      const first = (await row(session.UUID))!;
      deepStrictEqual({ width: first.width, height: first.height }, { width: 640, height: 480 });
      await writeUploadChunk(session.UUID, { offset: 65_536, bytes: image.subarray(65_536) });

      const { record } = await completeUploadSession(session.UUID);

      deepStrictEqual({ width: whole.width, height: whole.height }, { width: 640, height: 480 });
      deepStrictEqual({ width: record.width, height: record.height }, { width: 640, height: 480 });
    } finally {
      useLayers().remove('/uploads-sessions-complete-floor');
    }
  });

  it('lands inside a private folder as private, locking the object as putUpload does', async () => {
    await queryUntyped('Uploads').createOrThrow({
      kind: 'folder',
      directory: '',
      name: 'gnomeregan',
      private: true,
    });
    const whole = await putUpload({
      directory: 'gnomeregan/vault',
      name: 'a.txt',
      body: stream(LORE),
    });
    const session = await upload('gnomeregan/vault', 'b.txt', LORE);

    const { record } = await completeUploadSession(session.UUID);

    strictEqual(whole.private, true);
    strictEqual(record.private, true);
    strictEqual(storage.visibility.get('gnomeregan/vault/b.txt'), true);
    strictEqual(text(storage.objects.get('gnomeregan/vault/b.txt')), text(LORE));
  });

  it('resolves created true once, then the same record with false on a repeat', async () => {
    const session = await upload('ironforge', 'repeat.txt', LORE);

    const first = await completeUploadSession(session.UUID);
    const second = await completeUploadSession(session.UUID);

    strictEqual(first.created, true);
    strictEqual(second.created, false);
    deepStrictEqual(second.record, first.record);
  });

  it('answers the plain 404 on a repeat once the landed file falls out of reach', async () => {
    const session = await upload('ironforge', 'hidden.txt', LORE);
    const reach = { where: { private: false } };
    const { record } = await completeUploadSession(session.UUID, { reach });

    await queryUntyped('Uploads').where({ UUID: record.UUID }).updateOrThrow({ private: true });

    const error = await refusal(() => completeUploadSession(session.UUID, { reach }));
    strictEqual(error.status, 404);
    strictEqual(error.message, 'api.http.notFound');
  });

  it('sanitizes an SVG and journals the delete of the sealed object', async () => {
    const session = await upload('art', 'crest.svg', bytes(MARKUP));
    storage.failNext('delete');

    const { record } = await completeUploadSession(session.UUID);

    const stored = text(storage.objects.get('art/crest.svg'));
    ok(!stored.includes('script') && !stored.includes('onload') && stored.startsWith('<svg'));
    strictEqual(record.size, bytes(stored).byteLength);
    strictEqual(record.hash, sha256(bytes(stored)));
    deepStrictEqual({ width: record.width, height: record.height }, { width: 24, height: 12 });
    deepStrictEqual(await pending(), [{ op: 'delete', from: sessionTemp(session.UUID), to: null }]);
    ok(storage.objects.has(sessionTemp(session.UUID)));

    await drainJournal();
    strictEqual(storage.objects.has(sessionTemp(session.UUID)), false);
    deepStrictEqual(await pending(), []);
    deepStrictEqual(
      [...storage.objects.keys()].filter((key) => key.startsWith('.tmp/')),
      [],
    );
  });

  it('seals an SVG as an octet-stream attachment, and lands it as an SVG', async () => {
    const session = await upload('art', 'banner.svg', bytes(MARKUP));
    await sealBehindRow(session.UUID);

    deepStrictEqual(storage.metas.get(sessionTemp(session.UUID)), {
      type: 'application/octet-stream',
      size: bytes(MARKUP).byteLength,
      disposition: 'attachment',
    });

    const { record } = await completeUploadSession(session.UUID);

    strictEqual(session.type, 'image/svg+xml');
    strictEqual(record.type, 'image/svg+xml');
    deepStrictEqual(storage.metas.get('art/banner.svg'), {
      type: 'image/svg+xml',
      size: record.size,
      disposition: 'inline',
    });
  });

  it('keeps an SVG session whose markup holds no svg root, as every completion 422 does', async () => {
    const hollow = bytes('just text, and not a single tag in it, from Ironforge');
    const session = await upload('art', 'hollow.svg', hollow);

    for (let attempt = 0; attempt < 2; attempt++) {
      const errors = await failure(() => completeUploadSession(session.UUID));
      deepStrictEqual(errors, { name: 'uploads.errors.notSVG' });
    }

    const sealed = (await row(session.UUID))!;
    deepStrictEqual({ token: sealed.token, upload: sealed.upload }, { token: null, upload: null });
    deepStrictEqual(storage.objects.get(sessionTemp(session.UUID)), hollow);
    deepStrictEqual(await pending(), []);
    strictEqual(await queryUntyped('Uploads').where({ name: 'hollow.svg' }).exists(), false);
    await abortUploadSession(session.UUID);
    strictEqual(storage.objects.has(sessionTemp(session.UUID)), false);
  });

  it('keeps the sealed object and the session when the landing is refused', async () => {
    await putUpload({ directory: 'kharanos', name: 'readme', body: stream(bytes('r')) });
    const session = await upload('kharanos/readme', 'ale.txt', LORE);
    const { token } = (await row(session.UUID))!;

    for (let attempt = 0; attempt < 2; attempt++) {
      const errors = await failure(() => completeUploadSession(session.UUID));
      deepStrictEqual(errors, {
        directory: { key: 'uploads.errors.notAFolder', params: { path: 'kharanos/readme' } },
      });
    }

    const sealed = (await row(session.UUID))!;
    deepStrictEqual(
      { token: sealed.token, offset: sealed.offset, upload: sealed.upload },
      { token: null, offset: LORE.byteLength, upload: null },
    );
    strictEqual(storage.unfinished.has(token as string), false);
    deepStrictEqual(storage.objects.get(sessionTemp(session.UUID)), LORE);
    await abortUploadSession(session.UUID);
  });

  it('keeps the session when the landing falls out of reach, and lands once in reach', async () => {
    await queryUntyped('Uploads').createOrThrow({
      kind: 'folder',
      directory: '',
      name: 'blackrock',
      private: true,
    });
    const session = await upload('blackrock', 'forge.txt', LORE);

    const errors = await failure(() =>
      completeUploadSession(session.UUID, { reach: { where: { private: false } } }),
    );

    deepStrictEqual(errors, { '': 'uploads.errors.outOfReach' });
    strictEqual((await row(session.UUID))?.upload, null);
    const { record, created } = await completeUploadSession(session.UUID);
    strictEqual(created, true);
    strictEqual(record.path, 'blackrock/forge.txt');
  });

  it('refuses a type uploads.types no longer allows, keeping the session', async () => {
    const session = await upload('ironforge', 'decree.txt', LORE);
    useLayers().add({ path: '/uploads-sessions-images', input: { uploads: { types: ['image'] } } });
    try {
      const errors = await failure(() => completeUploadSession(session.UUID));

      deepStrictEqual(errors, {
        name: { key: 'uploads.errors.typeNotAllowed', params: { type: 'text/plain' } },
      });
      ok((await row(session.UUID))?.token);
    } finally {
      useLayers().remove('/uploads-sessions-images');
    }
    strictEqual((await completeUploadSession(session.UUID)).created, true);
  });

  it('seals again after a crash between the seal and forgetting the handle', async () => {
    const session = await upload('ironforge', 'crash.txt', LORE);
    await sealBehindRow(session.UUID);
    ok((await row(session.UUID))?.token);

    const { record } = await completeUploadSession(session.UUID);

    strictEqual(record.hash, sha256(LORE));
    deepStrictEqual(storage.objects.get('ironforge/crash.txt'), LORE);
  });

  it('refuses a sealed object of another size with a 500, keeping the session', async () => {
    const session = await upload('ironforge', 'lost.txt', LORE);
    await sealBehindRow(session.UUID);
    storage.objects.set(sessionTemp(session.UUID), LORE.subarray(0, 40));

    await rejects(completeUploadSession(session.UUID), (error: unknown) => {
      ok(isOhneError(error) && !(error instanceof HTTPError));
      strictEqual(
        error.message,
        `Upload session \`${session.UUID}\` sealed 40 of its ${LORE.byteLength} bytes`,
      );
      return true;
    });

    ok(await row(session.UUID));
    strictEqual(await queryUntyped('Uploads').where({ name: 'lost.txt' }).exists(), false);
    await abortUploadSession(session.UUID);
    strictEqual(storage.objects.has(sessionTemp(session.UUID)), false);
  });

  it('refuses the landing with a 409 when a rival completion claimed the session first', async () => {
    const rival = await putUpload({
      directory: 'ironforge',
      name: 'rival.txt',
      body: stream(LORE),
    });
    const session = await upload('ironforge', 'claimed.txt', LORE);
    const { stat } = storage;
    storage.stat = async (path) => {
      await tamper(session.UUID, { upload: rival.UUID });
      return stat(path);
    };
    try {
      const error = await refusal(() => completeUploadSession(session.UUID));

      strictEqual(error.status, 409);
      strictEqual((error.data as UploadSession).upload, rival.UUID);
    } finally {
      storage.stat = stat;
    }
    strictEqual(await queryUntyped('Uploads').where({ name: 'claimed.txt' }).exists(), false);
  });

  it('drains once the lock is released, on a repeat too', { timeout: 10_000 }, async () => {
    const session = await upload('ironforge', 'drain.txt', LORE);
    const { move } = storage;
    let entered = 0;
    storage.move = async (from, to) => {
      await withSessionLock(session.UUID, async () => {
        entered++;
      });
      return move(from, to);
    };
    try {
      storage.failNext('move');
      const first = await completeUploadSession(session.UUID);
      strictEqual(storage.objects.has('ironforge/drain.txt'), false);

      const second = await completeUploadSession(session.UUID);

      strictEqual(second.created, false);
      strictEqual(second.record.UUID, first.record.UUID);
      deepStrictEqual(storage.objects.get('ironforge/drain.txt'), LORE);
      strictEqual(entered, 2);
    } finally {
      storage.move = move;
    }
  });

  it('answers the plain 404 once the upload it landed as is deleted', async () => {
    const session = await upload('ironforge', 'fleeting.txt', LORE);
    const { record } = await completeUploadSession(session.UUID);

    await deleteUpload(record.UUID);

    strictEqual(await row(session.UUID), undefined);
    strictEqual((await refusal(() => completeUploadSession(session.UUID))).status, 404);
  });

  it('discards an expired session and answers sessionExpired', async () => {
    const session = await upload('ironforge', 'late.txt', LORE);
    await tamper(session.UUID, { expiresAt: Date.now() - 1 });

    const error = await refusal(() => completeUploadSession(session.UUID));

    strictEqual(error.status, 404);
    strictEqual(error.message, translate('uploads.errors.sessionExpired'));
    strictEqual(await row(session.UUID), undefined);
    strictEqual(await queryUntyped('Uploads').where({ name: 'late.txt' }).exists(), false);
  });
});
