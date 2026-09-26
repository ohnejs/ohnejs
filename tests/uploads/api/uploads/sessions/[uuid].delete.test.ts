import { ok, strictEqual } from 'node:assert';
import { after, describe, it } from 'node:test';

import type { UploadSession } from '../../../../../src/uploads/uploads/types.ts';

import { translate } from '../../../../../src/ohne/http/translate.ts';
import { useLayers } from '../../../../../src/ohne/layers/use-layers.ts';
import { queryUntyped } from '../../../../../src/ohne/query/query.ts';
import { getRouteOptions } from '../../../../../src/ohne/routes/route-options.ts';
import uuidDelete from '../../../../../src/uploads/api/uploads/sessions/[uuid].delete.ts';
import indexPost from '../../../../../src/uploads/api/uploads/sessions/index.post.ts';
import { completeUploadSession } from '../../../../../src/uploads/uploads/complete-upload-session.ts';
import { writeUploadChunk } from '../../../../../src/uploads/uploads/write-upload-chunk.ts';
import { bytes, call, route, storage, text, userWith } from '../../../_fixture.ts';

const LAYER = '/uploads-sessions-abort-route';
useLayers().add({ path: LAYER, input: { uploads: { chunkSize: 5 } } });
after(() => useLayers().remove(LAYER));

const create = route('POST', '/uploads/sessions', indexPost);
const del = route('DELETE', '/uploads/sessions/[uuid]', uuidDelete);
const thrall = await userWith('thrall@example.com', ['uploads-admin']);
const jaina = await userWith('jaina@example.com', ['uploads-admin']);
const peon = await userWith('peon@example.com', []);

const HORDE = bytes('For the Horde!');

/**
 * Opens a session for `HORDE` at the root under `name`, as `thrall`, and stores its first chunk.
 */
async function open(name: string): Promise<UploadSession> {
  const json = { name, size: HORDE.byteLength };
  const response = await call(create, '/uploads/sessions', {}, { bearer: thrall, json });
  strictEqual(response.status, 201);
  const { UUID } = (await response.json()) as UploadSession;
  return writeUploadChunk(UUID, { offset: 0, bytes: HORDE.subarray(0, 5) });
}

/**
 * Aborts the session `uuid` as `bearer`, `null` for no user.
 */
function abort(uuid: string, bearer: string | null = thrall): Promise<Response> {
  return call(del, `/uploads/sessions/${uuid}`, { uuid }, { bearer: bearer ?? undefined });
}

/**
 * The storage handle of the session row `uuid`, `undefined` once the row is gone.
 */
async function handle(uuid: string): Promise<string | undefined> {
  const row = await queryUntyped('UploadsSessions').unscoped().where({ UUID: uuid }).findFirst();
  return row?.token as string | undefined;
}

describe('DELETE /uploads/sessions/[uuid]', () => {
  it('drops the parts and the session, answering 204, then 404s a repeat', async () => {
    const session = await open('orgrim.txt');
    const token = await handle(session.UUID);
    ok(token && storage.unfinished.has(token));
    const response = await abort(session.UUID);
    strictEqual(response.status, 204);
    strictEqual(await response.text(), '');
    strictEqual(storage.unfinished.has(token), false);
    strictEqual(await handle(session.UUID), undefined);
    strictEqual((await abort(session.UUID)).status, 404);
  });

  it('keeps the file a completed session landed as, dropping only the session', async () => {
    let session = await open('garrosh.txt');
    for (const offset of [5, 10]) {
      const chunk = { offset, bytes: HORDE.subarray(offset, offset + 5) };
      session = await writeUploadChunk(session.UUID, chunk);
    }
    const { record } = await completeUploadSession(session.UUID);
    strictEqual((await abort(session.UUID)).status, 204);
    ok(await queryUntyped('Uploads').where({ UUID: record.UUID }).exists());
    strictEqual(text(storage.objects.get('garrosh.txt')), 'For the Horde!');
  });

  it('204s an expired session the caller opened, discarding it', async () => {
    const session = await open('rehgar.txt');
    await queryUntyped('UploadsSessions')
      .unscoped()
      .where({ UUID: session.UUID })
      .updateOrThrow({ expiresAt: Date.now() - 1 });
    strictEqual((await abort(session.UUID)).status, 204);
    strictEqual(await handle(session.UUID), undefined);
  });

  it('404s an unknown session, and one another user opened, keeping it', async () => {
    const session = await open('zuljin.txt');
    const foreign = await abort(session.UUID, jaina);
    strictEqual(foreign.status, 404);
    const { message } = (await foreign.json()) as { message: string };
    strictEqual(message, translate('api.http.notFound'));
    strictEqual((await abort('missing')).status, 404);
    ok(await handle(session.UUID));
  });

  it('runs without a deadline, since it may wait out a request that holds the session', () => {
    strictEqual(getRouteOptions(uuidDelete)?.handlerTimeout, false);
  });

  it('401s without a user and 403s without the capability', async () => {
    const session = await open('nazgrim.txt');
    strictEqual((await abort(session.UUID, null)).status, 401);
    strictEqual((await abort(session.UUID, peon)).status, 403);
    ok(await handle(session.UUID));
  });
});
