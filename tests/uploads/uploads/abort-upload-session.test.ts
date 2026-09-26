import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { after, describe, it } from 'node:test';

import type { UploadSession } from '../../../src/uploads/uploads/types.ts';

import { HTTPError } from '../../../src/ohne/http/http-error.ts';
import { translate } from '../../../src/ohne/http/translate.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { drainJournal } from '../../../src/uploads/storage/journal.ts';
import { sessionTemp } from '../../../src/uploads/uploads/_session.ts';
import { abortUploadSession } from '../../../src/uploads/uploads/abort-upload-session.ts';
import { completeUploadSession } from '../../../src/uploads/uploads/complete-upload-session.ts';
import { createUploadSession } from '../../../src/uploads/uploads/create-upload-session.ts';
import { putUpload } from '../../../src/uploads/uploads/put-upload.ts';
import { writeUploadChunk } from '../../../src/uploads/uploads/write-upload-chunk.ts';
import { bytes, storage, stream } from '../_fixture.ts';

const LAYER = '/uploads-sessions-abort';
useLayers().add({ path: LAYER, input: { uploads: { chunkSize: 16 } } });
after(() => useLayers().remove(LAYER));

const SCROLL = bytes('Light be with you, and with the Silver Hand.');

/**
 * The session row `uuid`, `undefined` once it is gone.
 */
function row(uuid: string): Promise<Record<string, unknown> | undefined> {
  return queryUntyped('UploadsSessions').unscoped().where({ UUID: uuid }).findFirst();
}

/**
 * Sets fields of the session row `uuid` directly, as a crash or the clock would leave them.
 */
function tamper(uuid: string, fields: Record<string, unknown>): Promise<unknown> {
  return queryUntyped('UploadsSessions').unscoped().where({ UUID: uuid }).updateOrThrow(fields);
}

/**
 * Opens a session for `SCROLL` at `directory`/`name`, owned by `author`, and sends its chunks up to `until`.
 */
async function upload(
  directory: string,
  name: string,
  { until = SCROLL.byteLength, author }: { until?: number; author?: string } = {},
): Promise<UploadSession> {
  let session = await createUploadSession({ directory, name, size: SCROLL.byteLength, author });
  while (session.offset < until) {
    const { offset, chunkSize } = session;
    const chunk = { offset, bytes: SCROLL.subarray(offset, offset + chunkSize) };
    session = await writeUploadChunk(session.UUID, chunk);
  }
  return session;
}

/**
 * The storage handle of the session `uuid`.
 */
async function tokenOf(uuid: string): Promise<string> {
  return (await row(uuid))?.token as string;
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

describe('abortUploadSession', () => {
  it('aborts an open session: its parts, then its row', async () => {
    const session = await upload('lordaeron', 'open.txt', { until: 16 });
    const token = await tokenOf(session.UUID);
    ok(storage.unfinished.has(token));

    await abortUploadSession(session.UUID);

    strictEqual(storage.unfinished.has(token), false);
    strictEqual(await row(session.UUID), undefined);
    strictEqual(storage.objects.has(sessionTemp(session.UUID)), false);
  });

  it('deletes the object of a sealed session with its row', async () => {
    await putUpload({ directory: 'lordaeron', name: 'wall', body: stream(bytes('w')) });
    const session = await upload('lordaeron/wall', 'sealed.txt');
    await rejects(completeUploadSession(session.UUID));
    ok(storage.objects.has(sessionTemp(session.UUID)));

    await abortUploadSession(session.UUID);

    strictEqual(storage.objects.has(sessionTemp(session.UUID)), false);
    strictEqual(await row(session.UUID), undefined);
  });

  it('drops only the row of a completed session, and its file stays', async () => {
    const session = await upload('lordaeron', 'completed.txt');
    const { record } = await completeUploadSession(session.UUID);

    await abortUploadSession(session.UUID);

    strictEqual(await row(session.UUID), undefined);
    deepStrictEqual(storage.objects.get('lordaeron/completed.txt'), SCROLL);
    ok(await queryUntyped('Uploads').where({ UUID: record.UUID }).exists());
  });

  it('leaves the pending move of a completed session to the journal', async () => {
    const session = await upload('lordaeron', 'moving.txt');
    storage.failNext('move');
    await completeUploadSession(session.UUID);
    deepStrictEqual(storage.objects.get(sessionTemp(session.UUID)), SCROLL);

    await abortUploadSession(session.UUID);

    strictEqual(await row(session.UUID), undefined);
    deepStrictEqual(storage.objects.get(sessionTemp(session.UUID)), SCROLL);
    await drainJournal();
    deepStrictEqual(storage.objects.get('lordaeron/moving.txt'), SCROLL);
    strictEqual(storage.objects.has(sessionTemp(session.UUID)), false);
  });

  it('discards a session whose handle a crash lost', async () => {
    const session = await upload('lordaeron', 'lost.txt', { until: 0 });
    await tamper(session.UUID, { token: null });

    await abortUploadSession(session.UUID);

    strictEqual(await row(session.UUID), undefined);
  });

  it('discards an expired session its author aborts', async () => {
    const session = await upload('lordaeron', 'expired.txt', { until: 16 });
    const token = await tokenOf(session.UUID);
    await tamper(session.UUID, { expiresAt: Date.now() - 1 });

    await abortUploadSession(session.UUID);

    strictEqual(await row(session.UUID), undefined);
    strictEqual(storage.unfinished.has(token), false);
  });

  it('keeps the session when storage fails, so a repeat finishes the job', async () => {
    const session = await upload('lordaeron', 'stubborn.txt', { until: 16 });
    const token = await tokenOf(session.UUID);
    storage.failNext('abort');

    await rejects(abortUploadSession(session.UUID), /memory storage abort failed/);

    ok(await row(session.UUID));
    ok(storage.unfinished.has(token));
    await abortUploadSession(session.UUID);
    strictEqual(await row(session.UUID), undefined);
    strictEqual(storage.unfinished.has(token), false);
  });

  it('answers the plain 404 for an unknown session and for a foreign one, keeping it', async () => {
    const tirion = await queryUntyped('Users').createOrThrow({
      email: 'tirion@hearthglen.test',
      password: 'pw-123456',
      roles: [],
    });
    const session = await upload('lordaeron', 'foreign.txt', {
      until: 16,
      author: tirion.UUID as string,
    });

    for (const uuid of [session.UUID, '01890a5d-ac96-774b-bcce-b302099a8057']) {
      const error = await refusal(() => abortUploadSession(uuid, { author: 'mograine' }));
      strictEqual(error.status, 404);
      strictEqual(error.message, translate('api.http.notFound'));
    }
    ok(await row(session.UUID));
    ok(storage.unfinished.has(await tokenOf(session.UUID)));
    await abortUploadSession(session.UUID, { author: tirion.UUID as string });
    strictEqual(await row(session.UUID), undefined);
  });
});
