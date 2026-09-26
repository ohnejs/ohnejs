import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { after, describe, it } from 'node:test';

import type { UploadSession } from '../../../../../src/uploads/uploads/types.ts';
import type { CallInit } from '../../../_fixture.ts';

import { routeLimits } from '../../../../../src/ohne/http/route-limits.ts';
import { translate } from '../../../../../src/ohne/http/translate.ts';
import { useLayers } from '../../../../../src/ohne/layers/use-layers.ts';
import { queryUntyped } from '../../../../../src/ohne/query/query.ts';
import { getRouteOptions } from '../../../../../src/ohne/routes/route-options.ts';
import uuidPatch from '../../../../../src/uploads/api/uploads/sessions/[uuid].patch.ts';
import indexPost from '../../../../../src/uploads/api/uploads/sessions/index.post.ts';
import { CHUNK_ROUTE_OPTIONS } from '../../../../../src/uploads/uploads/_body.ts';
import { completeUploadSession } from '../../../../../src/uploads/uploads/complete-upload-session.ts';
import {
  bytes,
  call,
  errorsOf,
  JPEG_HEAD,
  route,
  stalled,
  stream,
  userWith,
} from '../../../_fixture.ts';

const LAYER = '/uploads-sessions-chunk-route';
useLayers().add({ path: LAYER, input: { uploads: { chunkSize: 5 } } });
after(() => useLayers().remove(LAYER));

const create = route('POST', '/uploads/sessions', indexPost);
const patch = route('PATCH', '/uploads/sessions/[uuid]', uuidPatch);
const thrall = await userWith('thrall@example.com', ['uploads-admin']);
const jaina = await userWith('jaina@example.com', ['uploads-admin']);
const peon = await userWith('peon@example.com', []);

const HORDE = bytes('For the Horde!');

/**
 * Opens a session for `content` at the root under `name`, as `thrall`.
 */
async function open(name: string, content: Uint8Array): Promise<UploadSession> {
  const json = { name, size: content.byteLength };
  const response = await call(create, '/uploads/sessions', {}, { bearer: thrall, json });
  strictEqual(response.status, 201);
  return (await response.json()) as UploadSession;
}

/**
 * Sends a chunk to the session `uuid` with `offset` as its `upload-offset`.
 * It goes as `thrall` unless `init` sets `bearer`, and a `bearer` set to `undefined` sends no user.
 */
function send(uuid: string, offset: number | string, init: CallInit): Promise<Response> {
  const headers = { 'upload-offset': `${offset}`, ...init.headers };
  return call(patch, `/uploads/sessions/${uuid}`, { uuid }, { bearer: thrall, ...init, headers });
}

/**
 * The request that sends `chunk` whole, its length declared.
 */
function sized(chunk: Uint8Array): CallInit {
  return { body: stream(chunk), headers: { 'content-length': `${chunk.byteLength}` } };
}

/**
 * The request that sends the chunk of `HORDE` at `offset`, its length declared.
 */
function chunkAt(offset: number): CallInit {
  return sized(HORDE.subarray(offset, offset + 5));
}

/**
 * A body declared at `length` bytes whose `pulled` turns `true` once anything reads it.
 */
function unread(length: number): { init: CallInit; pulled: () => boolean } {
  let pulled = false;
  const body = stalled(
    'For t',
    async () => {
      pulled = true;
    },
    '',
  );
  return { init: { body, headers: { 'content-length': `${length}` } }, pulled: () => pulled };
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

describe('PATCH /uploads/sessions/[uuid]', () => {
  it('stores each chunk and answers the session advanced past it', async () => {
    const session = await open('orgrim.txt', HORDE);
    for (const offset of [0, 5, 10]) {
      const response = await send(session.UUID, offset, chunkAt(offset));
      strictEqual(response.status, 200);
      const advanced = Math.min(offset + 5, HORDE.byteLength);
      deepStrictEqual(await response.json(), { ...session, offset: advanced });
    }
    strictEqual((await row(session.UUID))?.offset, HORDE.byteLength);
  });

  it('409s a chunk at another offset before reading a byte of it, carrying the session', async () => {
    const session = await open('grommash.txt', HORDE);
    strictEqual((await send(session.UUID, 0, chunkAt(0))).status, 200);
    for (const [offset, length] of [
      [0, 5],
      [10, 4],
    ]) {
      const { init, pulled } = unread(length);
      const response = await send(session.UUID, offset, init);
      strictEqual(response.status, 409);
      deepStrictEqual((await refusal(response)).data, { ...session, offset: 5 });
      strictEqual(pulled(), false);
    }
  });

  it('409s any chunk of a completed session, the session naming its upload', async () => {
    const session = await open('garrosh.txt', HORDE);
    for (const offset of [0, 5, 10]) {
      await send(session.UUID, offset, chunkAt(offset));
    }
    const { record } = await completeUploadSession(session.UUID);
    const response = await send(session.UUID, 10, chunkAt(10));
    strictEqual(response.status, 409);
    const landed = { ...session, offset: HORDE.byteLength, upload: record.UUID };
    deepStrictEqual((await refusal(response)).data, landed);
  });

  it('400s a body without a positive declared length', async () => {
    const session = await open('nazgrel.txt', HORDE);
    const chunked = await send(session.UUID, 0, { body: stream(HORDE.subarray(0, 5)) });
    strictEqual(chunked.status, 400);
    const empty = { body: stream(bytes('')), headers: { 'content-length': '0' } };
    strictEqual((await send(session.UUID, 0, empty)).status, 400);
    strictEqual((await row(session.UUID))?.offset, 0);
  });

  it('400s an upload-offset that is missing or off the grid, or a length other than the chunk it names', async () => {
    const session = await open('varok.txt', HORDE);
    for (const offset of ['', 'north', 2.5, -5, 3, 15, 20]) {
      strictEqual((await send(session.UUID, offset, chunkAt(0))).status, 400, `offset ${offset}`);
    }
    for (const path of [
      `/uploads/sessions/${session.UUID}`,
      `/uploads/sessions/${session.UUID}?offset=0`,
    ]) {
      const bare = await call(
        patch,
        path,
        { uuid: session.UUID },
        { bearer: thrall, ...chunkAt(0) },
      );
      strictEqual(bare.status, 400, path);
    }
    strictEqual((await row(session.UUID))?.offset, 0);
    strictEqual((await send(session.UUID, 0, sized(HORDE.subarray(0, 4)))).status, 400);
    strictEqual((await send(session.UUID, 0, chunkAt(0))).status, 200);
    strictEqual((await send(session.UUID, 5, chunkAt(5))).status, 200);
    strictEqual((await send(session.UUID, 10, sized(HORDE.subarray(10, 13)))).status, 400);
    strictEqual((await row(session.UUID))?.offset, 10);
  });

  it('400s a body shorter than its declared length, storing nothing', async () => {
    const session = await open('drekthar.txt', HORDE);
    const short = { body: stream(bytes('For')), headers: { 'content-length': '5' } };
    strictEqual((await send(session.UUID, 0, short)).status, 400);
    strictEqual((await row(session.UUID))?.offset, 0);
  });

  it('413s a declared length past the route cap before the handler runs', async () => {
    const session = await open('broxigar.txt', HORDE);
    strictEqual(getRouteOptions(uuidPatch), CHUNK_ROUTE_OPTIONS);
    const { maxBodySize } = routeLimits(uuidPatch);
    ok(typeof maxBodySize === 'number');
    const { init, pulled } = unread(5);
    const response = await call(
      patch,
      `/uploads/sessions/${session.UUID}`,
      { uuid: session.UUID },
      {
        bearer: thrall,
        ...init,
        headers: { 'content-length': `${maxBodySize + 1}`, 'upload-offset': '0' },
      },
      { maxBodySize },
    );
    strictEqual(response.status, 413);
    strictEqual(pulled(), false);
    strictEqual((await row(session.UUID))?.offset, 0);
  });

  it('422s a first chunk that contradicts the type, discarding the session', async () => {
    const session = await open('kilrogg.png', JPEG_HEAD);
    const response = await send(session.UUID, 0, sized(JPEG_HEAD.subarray(0, 5)));
    strictEqual(response.status, 422);
    strictEqual(errorsOf(await response.json()).name, 'uploads.errors.contentMismatch');
    strictEqual(await row(session.UUID), undefined);
  });

  it('404s an unknown session, and one another user opened, keeping it', async () => {
    const session = await open('zuljin.txt', HORDE);
    const { init, pulled } = unread(5);
    const foreign = await send(session.UUID, 5, { ...init, bearer: jaina });
    strictEqual(foreign.status, 404);
    deepStrictEqual(await refusal(foreign), {
      statusCode: 404,
      message: translate('api.http.notFound'),
    });
    strictEqual(pulled(), false);
    strictEqual((await send('missing', 0, chunkAt(0))).status, 404);
    strictEqual((await row(session.UUID))?.offset, 0);
  });

  it('404s an expired session with sessionExpired, discarding it', async () => {
    const session = await open('rehgar.txt', HORDE);
    await queryUntyped('UploadsSessions')
      .unscoped()
      .where({ UUID: session.UUID })
      .updateOrThrow({ expiresAt: Date.now() - 1 });
    const response = await send(session.UUID, 0, chunkAt(0));
    strictEqual(response.status, 404);
    strictEqual((await refusal(response)).message, translate('uploads.errors.sessionExpired'));
    strictEqual(await row(session.UUID), undefined);
  });

  it('401s without a user and 403s without the capability', async () => {
    const session = await open('nazgrim.txt', HORDE);
    const nobody = await send(session.UUID, 0, { ...chunkAt(0), bearer: undefined });
    strictEqual(nobody.status, 401);
    const forbidden = await send(session.UUID, 0, { ...chunkAt(0), bearer: peon });
    strictEqual(forbidden.status, 403);
    strictEqual((await row(session.UUID))?.offset, 0);
  });
});
