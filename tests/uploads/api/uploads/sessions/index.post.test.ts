import { deepStrictEqual, strictEqual } from 'node:assert';
import { after, describe, it } from 'node:test';

import type { UploadSession } from '../../../../../src/uploads/uploads/types.ts';

import { createRouter } from '../../../../../src/ohne/http/router.ts';
import { translate } from '../../../../../src/ohne/http/translate.ts';
import { useLayers } from '../../../../../src/ohne/layers/use-layers.ts';
import { queryUntyped } from '../../../../../src/ohne/query/query.ts';
import pathGet from '../../../../../src/uploads/api/uploads/[...path].get.ts';
import uuidDelete from '../../../../../src/uploads/api/uploads/sessions/[uuid].delete.ts';
import uuidPatch from '../../../../../src/uploads/api/uploads/sessions/[uuid].patch.ts';
import completePost from '../../../../../src/uploads/api/uploads/sessions/[uuid]/complete.post.ts';
import indexPost from '../../../../../src/uploads/api/uploads/sessions/index.post.ts';
import { putUpload } from '../../../../../src/uploads/uploads/put-upload.ts';
import { bytes, call, route, storage, stream, text, userWith } from '../../../_fixture.ts';

const LAYER = '/uploads-sessions-create-route';
useLayers().add({ path: LAYER, input: { uploads: { chunkSize: 5 } } });
after(() => useLayers().remove(LAYER));

const create = route('POST', '/uploads/sessions', indexPost);
const thrall = await userWith('thrall@example.com', ['uploads-admin']);
const peon = await userWith('peon@example.com', []);

/**
 * Posts `json` to `POST /uploads/sessions` as `bearer`.
 */
function open(json: unknown, bearer = thrall): Promise<Response> {
  return call(create, '/uploads/sessions', {}, { bearer, json });
}

/**
 * How many session rows exist.
 */
function sessions(): Promise<number> {
  return queryUntyped('UploadsSessions').unscoped().count();
}

describe('POST /uploads/sessions', () => {
  it('opens a session at the canonical location and answers 201 with it', async () => {
    const response = await open({
      directory: 'Orgrimmar/Valley',
      name: 'Doomhammer.TXT',
      size: 12,
    });
    strictEqual(response.status, 201);
    const { UUID, expiresAt, ...session } = (await response.json()) as UploadSession;
    deepStrictEqual(session, {
      directory: 'orgrimmar/valley',
      name: 'doomhammer.txt',
      type: 'text/plain',
      size: 12,
      chunkSize: 5,
      offset: 0,
      upload: null,
    });
    const row = await queryUntyped('UploadsSessions').unscoped().where({ UUID }).findFirst();
    const user = await queryUntyped('Users').where({ email: 'thrall@example.com' }).findFirst();
    strictEqual(row?.author, user?.UUID);
    strictEqual(row?.expiresAt, expiresAt);
  });

  it('defaults the directory to the root', async () => {
    const response = await open({ name: 'grom.txt', size: 3 });
    strictEqual(response.status, 201);
    strictEqual(((await response.json()) as UploadSession).directory, '');
  });

  it('400s a missing or mistyped field, opening nothing', async () => {
    const before = await sessions();
    const bodies = [
      undefined,
      [],
      { size: 3 },
      { name: 7, size: 3 },
      { directory: 7, name: 'saurfang.txt', size: 3 },
      { name: 'saurfang.txt' },
      { name: 'saurfang.txt', size: '3' },
      { name: 'saurfang.txt', size: 0 },
      { name: 'saurfang.txt', size: 2.5 },
      { name: 'saurfang.txt', size: -3 },
    ];
    for (const json of bodies) {
      strictEqual((await open(json)).status, 400, JSON.stringify(json));
    }
    strictEqual(await sessions(), before);
  });

  it('501s on a storage without parts, opening nothing', async () => {
    const { parts } = storage;
    delete storage.parts;
    const before = await sessions();
    try {
      const response = await open({ name: 'rexxar.txt', size: 3 });
      strictEqual(response.status, 501);
      const { message } = (await response.json()) as { message: string };
      strictEqual(message, translate('uploads.errors.notResumable', { storage: 'memory' }));
      strictEqual(await sessions(), before);
    } finally {
      storage.parts = parts;
    }
  });

  it('401s without a user and 403s without the capability', async () => {
    const before = await sessions();
    const json = { name: 'zuljin.txt', size: 3 };
    strictEqual((await call(create, '/uploads/sessions', {}, { json })).status, 401);
    strictEqual((await open(json, peon)).status, 403);
    strictEqual(await sessions(), before);
  });

  it('leaves every GET under /uploads/sessions to GET /uploads/[...path]', async () => {
    const serve = route('GET', '/uploads/[...path]', pathGet);
    const router = createRouter([
      serve,
      create,
      route('PATCH', '/uploads/sessions/[uuid]', uuidPatch),
      route('DELETE', '/uploads/sessions/[uuid]', uuidDelete),
      route('POST', '/uploads/sessions/[uuid]/complete', completePost),
    ]);
    const files = [
      { directory: 'sessions', name: 'arthas.txt', content: 'Frostmourne hungers' },
      { directory: 'sessions/lich', name: 'complete', content: 'Icecrown' },
    ];
    for (const { directory, name, content } of files) {
      await putUpload({ directory, name, body: stream(bytes(content)) });
      const path = `${directory}/${name}`;
      const matched = { type: 'matched', route: serve, params: { path } };
      deepStrictEqual(router.match('GET', `/uploads/${path}`), matched);
      const response = await call(serve, `/uploads/${path}`, { path });
      strictEqual(response.status, 200);
      strictEqual(text(await response.bytes()), content);
    }
    const folder = { type: 'matched', route: serve, params: { path: 'sessions' } };
    deepStrictEqual(router.match('GET', '/uploads/sessions'), folder);
  });
});
