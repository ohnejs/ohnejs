import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { createHash } from 'node:crypto';
import { after, describe, it } from 'node:test';

import type { UploadRecord, UploadSession } from '../../../../../../src/uploads/uploads/types.ts';

import { useEnv } from '../../../../../../src/ohne/env/use-env.ts';
import { translate } from '../../../../../../src/ohne/http/translate.ts';
import { useLayers } from '../../../../../../src/ohne/layers/use-layers.ts';
import { queryUntyped } from '../../../../../../src/ohne/query/query.ts';
import uuidPatch from '../../../../../../src/uploads/api/uploads/sessions/[uuid].patch.ts';
import completePost from '../../../../../../src/uploads/api/uploads/sessions/[uuid]/complete.post.ts';
import indexPost from '../../../../../../src/uploads/api/uploads/sessions/index.post.ts';
import {
  bytes,
  call,
  caption,
  errorsOf,
  noSecrets,
  route,
  storage,
  stream,
  text,
  userWith,
  withReadAccess,
} from '../../../../_fixture.ts';

useEnv().set('UPLOADS_SECRET', 'secret');

const LAYER = '/uploads-sessions-complete-route';
useLayers().add({ path: LAYER, input: { uploads: { chunkSize: 5 } } });
after(() => useLayers().remove(LAYER));

const create = route('POST', '/uploads/sessions', indexPost);
const patch = route('PATCH', '/uploads/sessions/[uuid]', uuidPatch);
const complete = route('POST', '/uploads/sessions/[uuid]/complete', completePost);
const thrall = await userWith('thrall@example.com', ['uploads-admin']);
const jaina = await userWith('jaina@example.com', ['uploads-admin']);
const peon = await userWith('peon@example.com', []);
const visibleOnly = () => ({ where: { private: false } });
await queryUntyped('Uploads').createOrThrow({
  kind: 'folder',
  directory: '',
  name: 'vault',
  private: true,
});

const HORDE = bytes('For the Horde!');

/**
 * Opens a session for `content` at `directory`/`name` and sends its chunks up to `until`, as `thrall`.
 */
async function upload(
  directory: string,
  name: string,
  content: Uint8Array,
  until = content.byteLength,
): Promise<UploadSession> {
  const json = { directory, name, size: content.byteLength };
  const opened = await call(create, '/uploads/sessions', {}, { bearer: thrall, json });
  strictEqual(opened.status, 201);
  let session = (await opened.json()) as UploadSession;
  while (session.offset < until) {
    const { UUID: uuid, offset, chunkSize } = session;
    const chunk = content.subarray(offset, offset + chunkSize);
    const headers = { 'content-length': `${chunk.byteLength}`, 'upload-offset': `${offset}` };
    const response = await call(
      patch,
      `/uploads/sessions/${uuid}`,
      { uuid },
      { bearer: thrall, body: stream(chunk), headers },
    );
    strictEqual(response.status, 200);
    session = (await response.json()) as UploadSession;
  }
  return session;
}

/**
 * Completes the session `uuid` as `bearer`, `null` for no user.
 */
function finish(uuid: string, bearer: string | null = thrall): Promise<Response> {
  return call(
    complete,
    `/uploads/sessions/${uuid}/complete`,
    { uuid },
    { bearer: bearer ?? undefined },
  );
}

/**
 * The session row `uuid`, `undefined` once it is gone.
 */
function row(uuid: string): Promise<Record<string, unknown> | undefined> {
  return queryUntyped('UploadsSessions').unscoped().where({ UUID: uuid }).findFirst();
}

/**
 * The `message` and `data` of an error response.
 */
async function refusal(response: Response): Promise<{ message: string; data?: unknown }> {
  return (await response.json()) as { message: string; data?: unknown };
}

describe('POST /uploads/sessions/[uuid]/complete', () => {
  it('lands a file sent in chunks and answers 201, then 200 with the same record', async () => {
    const session = await upload('Orgrimmar', 'Warchief.TXT', HORDE);
    const first = await finish(session.UUID);
    strictEqual(first.status, 201);
    const record = (await first.json()) as UploadRecord;
    strictEqual(record.path, 'orgrimmar/warchief.txt');
    strictEqual(record.type, 'text/plain');
    strictEqual(record.size, HORDE.byteLength);
    strictEqual(record.hash, createHash('sha256').update(HORDE).digest('hex'));
    const user = await queryUntyped('Users').where({ email: 'thrall@example.com' }).findFirst();
    strictEqual(record.author, user?.UUID);
    strictEqual(text(storage.objects.get('orgrimmar/warchief.txt')), 'For the Horde!');

    const repeat = await finish(session.UUID);
    strictEqual(repeat.status, 200);
    deepStrictEqual(await repeat.json(), record);
    strictEqual((await row(session.UUID))?.upload, record.UUID);
  });

  it('409s while bytes are missing, carrying the session to resume from', async () => {
    const session = await upload('', 'grommash.txt', HORDE, 5);
    const response = await finish(session.UUID);
    strictEqual(response.status, 409);
    deepStrictEqual((await refusal(response)).data, session);
  });

  it('422s a landing the read access scope would hide, keeping the session', async () => {
    const session = await upload('vault', 'frostmourne.txt', HORDE);
    await withReadAccess(visibleOnly, async () => {
      const response = await finish(session.UUID);
      strictEqual(response.status, 422);
      strictEqual(errorsOf(await response.json())[''], 'uploads.errors.outOfReach');
    });
    const landed = queryUntyped('Uploads').where({ directory: 'vault', name: 'frostmourne.txt' });
    strictEqual(await landed.exists(), false);
    ok(await row(session.UUID));
    strictEqual((await finish(session.UUID)).status, 201);
    strictEqual(await landed.exists(), true);
  });

  it('404s a repeat once the read access scope hides the file it landed as', async () => {
    const session = await upload('vault', 'gorehowl.txt', HORDE);
    strictEqual((await finish(session.UUID)).status, 201);
    await withReadAccess(visibleOnly, async () => {
      const repeat = await finish(session.UUID);
      strictEqual(repeat.status, 404);
      strictEqual((await refusal(repeat)).message, translate('api.http.notFound'));
    });
    strictEqual((await finish(session.UUID)).status, 200);
  });

  it('404s a repeat to a caller whose read access scope is `false`', async () => {
    const session = await upload('', 'saurfang.txt', HORDE);
    strictEqual((await finish(session.UUID)).status, 201);
    await withReadAccess(
      () => false,
      async () => strictEqual((await finish(session.UUID)).status, 404),
    );
  });

  it('404s an unknown session, and one another user opened, keeping it', async () => {
    const session = await upload('', 'zuljin.txt', HORDE);
    const foreign = await finish(session.UUID, jaina);
    strictEqual(foreign.status, 404);
    strictEqual((await refusal(foreign)).message, translate('api.http.notFound'));
    strictEqual((await finish('missing')).status, 404);
    strictEqual((await row(session.UUID))?.upload, null);
  });

  it('404s an expired session with sessionExpired, discarding it', async () => {
    const session = await upload('', 'rehgar.txt', HORDE);
    await queryUntyped('UploadsSessions')
      .unscoped()
      .where({ UUID: session.UUID })
      .updateOrThrow({ expiresAt: Date.now() - 1 });
    const response = await finish(session.UUID);
    strictEqual(response.status, 404);
    strictEqual((await refusal(response)).message, translate('uploads.errors.sessionExpired'));
    strictEqual(await row(session.UUID), undefined);
  });

  it('401s without a user and 403s without the capability', async () => {
    const session = await upload('', 'nazgrim.txt', HORDE);
    strictEqual((await finish(session.UUID, null)).status, 401);
    strictEqual((await finish(session.UUID, peon)).status, 403);
    strictEqual((await row(session.UUID))?.upload, null);
  });

  it('answers a repeat with only the locales the read scope admits the file at', async () => {
    const session = await upload('', 'rexxar.txt', HORDE);
    const record = (await (await finish(session.UUID)).json()) as UploadRecord;
    await caption(record.UUID, 'Caption', 'SECRET Beschriftung');
    await withReadAccess(noSecrets, async () => {
      const repeat = await finish(session.UUID);
      strictEqual(repeat.status, 200);
      deepStrictEqual(((await repeat.json()) as Record<string, unknown>)._translations, ['en']);
    });
  });
});
