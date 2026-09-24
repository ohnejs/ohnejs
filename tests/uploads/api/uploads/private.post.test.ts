import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { useEnv } from '../../../../src/ohne/env/use-env.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';
import privatePost from '../../../../src/uploads/api/uploads/private.post.ts';
import { BULK_LIMIT } from '../../../../src/uploads/uploads/_body.ts';
import { createFolder } from '../../../../src/uploads/uploads/create-folder.ts';
import { putUpload } from '../../../../src/uploads/uploads/put-upload.ts';
import { updateUpload } from '../../../../src/uploads/uploads/update-upload.ts';
import {
  bytes,
  call,
  errorsOf,
  route,
  storage,
  stream,
  userWith,
  withReadAccess,
} from '../../_fixture.ts';

useEnv().set('UPLOADS_SECRET', 'secret');

const lock = route('POST', '/uploads/private', privatePost);
const admin = await userWith('admin@example.com', ['uploads-admin']);
const nobody = await userWith('nobody@example.com', []);
const visibleOnly = () => ({ where: { private: false } });

async function seed(directory: string, name: string): Promise<string> {
  const upload = await putUpload({ directory, name, body: stream(bytes(name)) });
  return upload.UUID;
}

async function privacy(uuids: string[]): Promise<unknown[]> {
  const rows = await queryUntyped('Uploads')
    .where({ UUID: { in: uuids } })
    .findMany();
  return uuids.map((uuid) => rows.find((row) => row.UUID === uuid)?.private);
}

function send(json: unknown, bearer = admin): Promise<Response> {
  return call(lock, '/uploads/private', {}, { bearer, json });
}

describe('POST /uploads/private', () => {
  it('drops a repeated UUID under a read scope', async () => {
    const twice = await seed('pv', 'twice.txt');
    await withReadAccess(visibleOnly, async () => {
      strictEqual((await send({ uuids: [twice, twice], private: false })).status, 200);
    });
    deepStrictEqual(await privacy([twice]), [false]);
  });

  it('locks every row and answers their records', async () => {
    const folder = await createFolder({ directory: 'pv', name: 'box' });
    const inner = await seed('pv/box', 'inner.txt');
    const file = await seed('pv', 'file.txt');
    const response = await send({ uuids: [file, folder.UUID], private: true });
    strictEqual(response.status, 200);
    const records = (await response.json()) as Record<string, unknown>[];
    deepStrictEqual(
      records.map((record) => [record.path, record.private]),
      [
        ['pv/file.txt', true],
        ['pv/box', true],
      ],
    );
    deepStrictEqual(await privacy([inner]), [true]);
    strictEqual(storage.visibility.get('pv/box/inner.txt'), true);
    strictEqual(await queryUntyped('UploadsJournal').count(), 0);
  });

  it('422s a row made public inside a private folder, changing nothing', async () => {
    const free = await seed('pv', 'free.txt');
    await updateUpload(free, { private: true });
    const vault = await createFolder({ directory: 'pv', name: 'vault' });
    const inner = await seed('pv/vault', 'inner.txt');
    await updateUpload(vault.UUID, { private: true });
    const response = await send({ uuids: [free, inner], private: false });
    strictEqual(response.status, 422);
    strictEqual(errorsOf(await response.json()).private, 'uploads.errors.insidePrivateFolder');
    deepStrictEqual(await privacy([free, inner]), [true, true]);
    strictEqual(await queryUntyped('UploadsJournal').count(), 0);
  });

  it('400s a bad body', async () => {
    const uuid = await seed('pv', 'shape.txt');
    const tooMany = Array.from({ length: BULK_LIMIT + 1 }, () => uuid);
    const bodies = [
      null,
      { uuids: [], private: true },
      { uuids: [uuid, null], private: true },
      { uuids: tooMany, private: true },
      { uuids: [uuid] },
      { uuids: [uuid], private: 'yes' },
    ];
    for (const body of bodies) strictEqual((await send(body)).status, 400);
    deepStrictEqual(await privacy([uuid]), [false]);
  });

  it('400s while no secret makes the layer keep private files', async () => {
    const uuid = await seed('pv', 'nosecret.txt');
    useEnv().unset('UPLOADS_SECRET');
    try {
      strictEqual((await send({ uuids: [uuid], private: true })).status, 400);
    } finally {
      useEnv().set('UPLOADS_SECRET', 'secret');
    }
  });

  it('404s an unknown UUID or one the read scope hides, before a bad value', async () => {
    const seen = await seed('pv', 'seen.txt');
    const hidden = await seed('pv', 'hidden.txt');
    await updateUpload(hidden, { private: true });
    strictEqual((await send({ uuids: [seen, 'missing'], private: true })).status, 404);
    await withReadAccess(visibleOnly, async () => {
      strictEqual((await send({ uuids: [seen, hidden], private: false })).status, 404);
      strictEqual((await send({ uuids: [seen, hidden], private: 'no' })).status, 404);
    });
    deepStrictEqual(await privacy([seen, hidden]), [false, true]);
  });

  it('422s a lock that would hide a row from the read scope, changing nothing', async () => {
    const a = await seed('pv', 'a.txt');
    const b = await seed('pv', 'b.txt');
    await withReadAccess(visibleOnly, async () => {
      const response = await send({ uuids: [a, b], private: true });
      strictEqual(response.status, 422);
      strictEqual(errorsOf(await response.json())[''], 'uploads.errors.outOfReach');
    });
    deepStrictEqual(await privacy([a, b]), [false, false]);
    strictEqual(storage.visibility.has('pv/a.txt'), false);
  });

  it('401s without a user and 403s without the capability', async () => {
    const uuid = await seed('pv', 'guarded.txt');
    strictEqual(
      (await call(lock, '/uploads/private', {}, { json: { uuids: [uuid], private: true } })).status,
      401,
    );
    strictEqual((await send({ uuids: [uuid], private: true }, nobody)).status, 403);
    deepStrictEqual(await privacy([uuid]), [false]);
  });
});
