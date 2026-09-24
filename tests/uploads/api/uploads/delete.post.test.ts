import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { useEnv } from '../../../../src/ohne/env/use-env.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';
import deletePost from '../../../../src/uploads/api/uploads/delete.post.ts';
import { BULK_LIMIT } from '../../../../src/uploads/uploads/_body.ts';
import { createFolder } from '../../../../src/uploads/uploads/create-folder.ts';
import { putUpload } from '../../../../src/uploads/uploads/put-upload.ts';
import { updateUpload } from '../../../../src/uploads/uploads/update-upload.ts';
import { bytes, call, route, storage, stream, userWith, withReadAccess } from '../../_fixture.ts';

useEnv().set('UPLOADS_SECRET', 'secret');

const del = route('POST', '/uploads/delete', deletePost);
const admin = await userWith('admin@example.com', ['uploads-admin']);
const nobody = await userWith('nobody@example.com', []);
const visibleOnly = () => ({ where: { private: false } });

async function seed(directory: string, name: string): Promise<string> {
  const upload = await putUpload({ directory, name, body: stream(bytes(name)) });
  return upload.UUID;
}

function objects(prefix: string): string[] {
  return [...storage.objects.keys()].filter((key) => key.startsWith(prefix)).sort();
}

function send(json: unknown, bearer = admin): Promise<Response> {
  return call(del, '/uploads/delete', {}, { bearer, json });
}

describe('POST /uploads/delete', () => {
  it('deletes every row and its object, answering 204', async () => {
    const one = await seed('rm', 'one.txt');
    const folder = await createFolder({ directory: 'rm', name: 'box' });
    const inner = await seed('rm/box/deep', 'inner.txt');
    await seed('rm', 'kept.txt');
    const response = await send({ uuids: [inner, one, folder.UUID] });
    strictEqual(response.status, 204);
    strictEqual(await response.text(), '');
    const gone = [one, folder.UUID, inner];
    strictEqual(
      await queryUntyped('Uploads')
        .where({ UUID: { in: gone } })
        .count(),
      0,
    );
    deepStrictEqual(objects('rm/'), ['rm/kept.txt']);
    strictEqual(await queryUntyped('UploadsJournal').count(), 0);
  });

  it('400s a bad body', async () => {
    const uuid = await seed('rm', 'shape.txt');
    const tooMany = Array.from({ length: BULK_LIMIT + 1 }, () => uuid);
    const bodies = [null, {}, { uuids: [] }, { uuids: [{}] }, { uuids: tooMany }];
    for (const body of bodies) strictEqual((await send(body)).status, 400);
    strictEqual(storage.objects.has('rm/shape.txt'), true);
  });

  it('404s an unknown UUID or one the read scope hides, deleting nothing', async () => {
    const seen = await seed('rm', 'seen.txt');
    const hidden = await seed('rm', 'hidden.txt');
    await updateUpload(hidden, { private: true });
    strictEqual((await send({ uuids: [seen, 'missing'] })).status, 404);
    await withReadAccess(visibleOnly, async () => {
      strictEqual((await send({ uuids: [seen, hidden] })).status, 404);
    });
    strictEqual(
      await queryUntyped('Uploads')
        .where({ UUID: { in: [seen, hidden] } })
        .count(),
      2,
    );
    strictEqual(storage.objects.has('rm/seen.txt'), true);
    strictEqual(await queryUntyped('UploadsJournal').count(), 0);
  });

  it('deletes a visible folder with a child the scope hides', async () => {
    const folder = await createFolder({ directory: 'rm', name: 'shown' });
    const child = await seed('rm/shown', 'child.txt');
    await updateUpload(child, { private: true });
    await withReadAccess(visibleOnly, async () => {
      strictEqual((await send({ uuids: [folder.UUID] })).status, 204);
    });
    strictEqual(await queryUntyped('Uploads').where({ UUID: child }).exists(), false);
    strictEqual(storage.objects.has('rm/shown/child.txt'), false);
  });

  it('401s without a user and 403s without the capability', async () => {
    const uuid = await seed('rm', 'guarded.txt');
    strictEqual((await call(del, '/uploads/delete', {}, { json: { uuids: [uuid] } })).status, 401);
    strictEqual((await send({ uuids: [uuid] }, nobody)).status, 403);
    strictEqual(storage.objects.has('rm/guarded.txt'), true);
  });
});
