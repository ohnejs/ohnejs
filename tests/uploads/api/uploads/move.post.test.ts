import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { useEnv } from '../../../../src/ohne/env/use-env.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';
import movePost from '../../../../src/uploads/api/uploads/move.post.ts';
import { BULK_LIMIT } from '../../../../src/uploads/uploads/_body.ts';
import { createFolder } from '../../../../src/uploads/uploads/create-folder.ts';
import { putUpload } from '../../../../src/uploads/uploads/put-upload.ts';
import { updateUpload } from '../../../../src/uploads/uploads/update-upload.ts';
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
} from '../../_fixture.ts';

useEnv().set('UPLOADS_SECRET', 'secret');

const move = route('POST', '/uploads/move', movePost);
const admin = await userWith('admin@example.com', ['uploads-admin']);
const nobody = await userWith('nobody@example.com', []);
const visibleOnly = () => ({ where: { private: false } });

async function seed(directory: string, name: string): Promise<string> {
  const upload = await putUpload({ directory, name, body: stream(bytes(name)) });
  return upload.UUID;
}

async function pathOf(uuid: string): Promise<string> {
  const row = await queryUntyped('Uploads').where({ UUID: uuid }).findFirst();
  return `${row?.directory}/${row?.name}`;
}

function send(json: unknown, bearer = admin): Promise<Response> {
  return call(move, '/uploads/move', {}, { bearer, json });
}

describe('POST /uploads/move', () => {
  it('moves every row and answers their records', async () => {
    const a = await seed('mv', 'a.txt');
    const b = await seed('mv/in', 'b.txt');
    const response = await send({ uuids: [a, b], directory: 'mv/out' });
    strictEqual(response.status, 200);
    const records = (await response.json()) as Record<string, unknown>[];
    deepStrictEqual(
      records.map((record) => record.path),
      ['mv/out/a.txt', 'mv/out/b.txt'],
    );
    strictEqual(text(storage.objects.get('mv/out/b.txt')), 'b.txt');
    strictEqual(await queryUntyped('UploadsJournal').count(), 0);
  });

  it('drops a repeated UUID under a read scope', async () => {
    const twice = await seed('mv', 'twice.txt');
    await withReadAccess(visibleOnly, async () => {
      strictEqual((await send({ uuids: [twice, twice], directory: 'mv/twin' })).status, 200);
    });
    strictEqual(await pathOf(twice), 'mv/twin/twice.txt');
  });

  it('carries a named row inside a moving folder along with it', async () => {
    const folder = await createFolder({ directory: 'mv', name: 'box' });
    const inner = await seed('mv/box', 'inner.txt');
    strictEqual((await send({ uuids: [inner, folder.UUID], directory: 'mv/dest' })).status, 200);
    strictEqual(await pathOf(inner), 'mv/dest/box/inner.txt');
  });

  it('422s a folder moved into itself, moving nothing', async () => {
    const file = await seed('mv', 'first.txt');
    const folder = await createFolder({ directory: 'mv', name: 'loop' });
    const response = await send({ uuids: [file, folder.UUID], directory: 'mv/loop/in' });
    strictEqual(response.status, 422);
    strictEqual(errorsOf(await response.json()).directory, 'uploads.errors.folderIntoItself');
    strictEqual(await pathOf(file), 'mv/first.txt');
    strictEqual(await queryUntyped('UploadsJournal').count(), 0);
  });

  it('400s a bad body', async () => {
    const uuid = await seed('mv', 'shape.txt');
    const tooMany = Array.from({ length: BULK_LIMIT + 1 }, () => uuid);
    const bodies = [
      null,
      {},
      { uuids: [], directory: 'x' },
      { uuids: uuid, directory: 'x' },
      { uuids: [uuid, 7], directory: 'x' },
      { uuids: tooMany, directory: 'x' },
      { uuids: [uuid] },
      { uuids: [uuid], directory: 7 },
    ];
    for (const body of bodies) strictEqual((await send(body)).status, 400);
    strictEqual(await pathOf(uuid), 'mv/shape.txt');
  });

  it('404s an unknown UUID or one the read scope hides, before a bad directory', async () => {
    const seen = await seed('mv', 'seen.txt');
    const hidden = await seed('mv', 'hidden.txt');
    await updateUpload(hidden, { private: true });
    strictEqual((await send({ uuids: [seen, 'missing'], directory: 'x' })).status, 404);
    await withReadAccess(visibleOnly, async () => {
      strictEqual((await send({ uuids: [seen, hidden], directory: 'x' })).status, 404);
      strictEqual((await send({ uuids: [seen, hidden], directory: 7 })).status, 404);
    });
    strictEqual(await pathOf(seen), 'mv/seen.txt');
    strictEqual(await pathOf(hidden), 'mv/hidden.txt');
  });

  it('422s a move that would hide a row from the read scope, moving nothing', async () => {
    await createFolder({ directory: 'mv', name: 'crypt' }).then((folder) =>
      updateUpload(folder.UUID, { private: true }),
    );
    const one = await seed('mv', 'one.txt');
    await withReadAccess(visibleOnly, async () => {
      const response = await send({ uuids: [one], directory: 'mv/crypt' });
      strictEqual(response.status, 422);
      strictEqual(errorsOf(await response.json())[''], 'uploads.errors.outOfReach');
    });
    strictEqual(await pathOf(one), 'mv/one.txt');
  });

  it('401s without a user and 403s without the capability', async () => {
    const uuid = await seed('mv', 'guarded.txt');
    strictEqual(
      (await call(move, '/uploads/move', {}, { json: { uuids: [uuid], directory: 'x' } })).status,
      401,
    );
    strictEqual((await send({ uuids: [uuid], directory: 'x' }, nobody)).status, 403);
    strictEqual(await pathOf(uuid), 'mv/guarded.txt');
  });

  it('answers only the locales the read scope admits each row at', async () => {
    const moving = await seed('mv', 'lingo.txt');
    const staying = await seed('mv/lingo', 'still.txt');
    await caption(moving, 'Caption', 'SECRET Beschriftung');
    await caption(staying, 'Caption', 'SECRET Beschriftung');
    await withReadAccess(noSecrets, async () => {
      const response = await send({ uuids: [moving, staying], directory: 'mv/lingo' });
      strictEqual(response.status, 200);
      const records = (await response.json()) as Record<string, unknown>[];
      deepStrictEqual(
        records.map((record) => record._translations),
        [['en'], ['en']],
      );
    });
  });
});
