import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { useEnv } from '../../../../src/ohne/env/use-env.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';
import { useRoles } from '../../../../src/ohne/roles/use-roles.ts';
import uuidDelete from '../../../../src/uploads/api/uploads/[uuid].delete.ts';
import { createFolder } from '../../../../src/uploads/uploads/create-folder.ts';
import { putUpload } from '../../../../src/uploads/uploads/put-upload.ts';
import { updateUpload } from '../../../../src/uploads/uploads/update-upload.ts';
import { bytes, call, route, storage, stream, userWith, withReadAccess } from '../../_fixture.ts';

useEnv().set('UPLOADS_SECRET', 'secret');

const del = route('DELETE', '/uploads/[uuid]', uuidDelete);
const admin = await userWith('admin@example.com', ['uploads-admin']);
const nobody = await userWith('nobody@example.com', []);
useRoles().register('uploads-deleter', {
  name: 'uploads-deleter',
  role: { capabilities: ['collection.Uploads.delete'] },
});
const deleter = await userWith('deleter@example.com', ['uploads-deleter']);
const visibleOnly = () => ({ where: { private: false } });

async function hiddenFile(directory: string, name: string): Promise<string> {
  const upload = await putUpload({ directory, name, body: stream(bytes(name)) });
  await updateUpload(upload.UUID, { private: true });
  return upload.UUID;
}

function send(uuid: string, bearer?: string): Promise<Response> {
  return call(del, `/uploads/${uuid}`, { uuid }, { bearer });
}

describe('DELETE /uploads/[uuid]', () => {
  it('deletes the row and the object, answering 204, then 404s a repeat', async () => {
    const upload = await putUpload({ directory: 'del', name: 'a.txt', body: stream(bytes('a')) });
    const response = await send(upload.UUID, admin);
    strictEqual(response.status, 204);
    strictEqual(await response.text(), '');
    strictEqual(await queryUntyped('Uploads').where({ UUID: upload.UUID }).exists(), false);
    strictEqual(storage.objects.has('del/a.txt'), false);
    strictEqual((await send(upload.UUID, admin)).status, 404);
  });

  it('deletes a folder with its subtree', async () => {
    await putUpload({ directory: 'del/tree/deep', name: 'leaf.txt', body: stream(bytes('l')) });
    const folder = await queryUntyped('Uploads')
      .where({ directory: 'del', name: 'tree' })
      .findFirst();
    strictEqual((await send(folder?.UUID as string, admin)).status, 204);
    strictEqual(await queryUntyped('Uploads').where({ directory: 'del/tree/deep' }).count(), 0);
    strictEqual(storage.objects.has('del/tree/deep/leaf.txt'), false);
  });

  it('401s without a user and 403s without the capability', async () => {
    const upload = await putUpload({
      directory: 'del',
      name: 'kept.txt',
      body: stream(bytes('k')),
    });
    strictEqual((await send(upload.UUID)).status, 401);
    strictEqual((await send(upload.UUID, nobody)).status, 403);
    strictEqual(storage.objects.has('del/kept.txt'), true);
  });

  it('404s a row the read access scope hides, keeping it', async () => {
    const uuid = await hiddenFile('del', 'hidden.txt');
    await withReadAccess(visibleOnly, async () => {
      strictEqual((await send(uuid, admin)).status, 404);
    });
    strictEqual(await queryUntyped('Uploads').where({ UUID: uuid }).exists(), true);
    strictEqual(storage.objects.has('del/hidden.txt'), true);
  });

  it('deletes a visible folder with a child the scope hides', async () => {
    const folder = await createFolder({ directory: 'del', name: 'shown' });
    const child = await hiddenFile('del/shown', 'child.txt');
    await withReadAccess(visibleOnly, async () => {
      strictEqual((await send(folder.UUID, admin)).status, 204);
    });
    strictEqual(await queryUntyped('Uploads').where({ UUID: child }).exists(), false);
    strictEqual(storage.objects.has('del/shown/child.txt'), false);
  });

  it('403s the delete capability without the read one', async () => {
    const upload = await putUpload({ directory: 'del', name: 'd.txt', body: stream(bytes('d')) });
    strictEqual((await send(upload.UUID, deleter)).status, 403);
    strictEqual(storage.objects.has('del/d.txt'), true);
  });
});
