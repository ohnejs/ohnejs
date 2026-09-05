import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { queryUntyped } from '../../../../src/ohne/query/query.ts';
import uuidDelete from '../../../../src/uploads/api/uploads/[uuid].delete.ts';
import { putUpload } from '../../../../src/uploads/uploads/put-upload.ts';
import { bytes, call, route, storage, stream, userWith } from '../../_fixture.ts';

const del = route('DELETE', '/uploads/[uuid]', uuidDelete);
const admin = await userWith('admin@example.com', ['uploads-admin']);
const nobody = await userWith('nobody@example.com', []);

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
});
