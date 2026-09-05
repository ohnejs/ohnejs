import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { queryUntyped } from '../../../../src/ohne/query/query.ts';
import foldersPost from '../../../../src/uploads/api/uploads/folders.post.ts';
import { call, errorsOf, route, storage, userWith } from '../../_fixture.ts';

const folders = route('POST', '/uploads/folders', foldersPost);
const admin = await userWith('admin@example.com', ['uploads-admin']);

describe('POST /uploads/folders', () => {
  it('creates the folder and its ancestors, answering 201', async () => {
    const before = storage.objects.size;
    const response = await call(
      folders,
      '/uploads/folders',
      {},
      {
        bearer: admin,
        json: { directory: 'Docs/2024', name: 'Q3 Reports' },
      },
    );
    strictEqual(response.status, 201);
    const record = (await response.json()) as Record<string, unknown>;
    strictEqual(record.kind, 'folder');
    strictEqual(record.path, 'docs/2024/q3-reports');
    strictEqual(
      await queryUntyped('Uploads').where({ directory: 'docs', name: '2024' }).count(),
      1,
    );
    strictEqual(storage.objects.size, before);
  });

  it('defaults the directory to the root', async () => {
    const response = await call(
      folders,
      '/uploads/folders',
      {},
      { bearer: admin, json: { name: 'top' } },
    );
    strictEqual(response.status, 201);
    strictEqual(((await response.json()) as { path: string }).path, 'top');
  });

  it('400s a body without a name, a null body included', async () => {
    strictEqual(
      (await call(folders, '/uploads/folders', {}, { bearer: admin, json: {} })).status,
      400,
    );
    strictEqual(
      (await call(folders, '/uploads/folders', {}, { bearer: admin, json: null })).status,
      400,
    );
    strictEqual(
      (await call(folders, '/uploads/folders', {}, { bearer: admin, json: { name: 1 } })).status,
      400,
    );
  });

  it('422s a name already taken', async () => {
    await call(folders, '/uploads/folders', {}, { bearer: admin, json: { name: 'dup' } });
    const response = await call(
      folders,
      '/uploads/folders',
      {},
      { bearer: admin, json: { name: 'Dup' } },
    );
    strictEqual(response.status, 422);
    strictEqual(errorsOf(await response.json()).name, 'validation.notUnique');
  });

  it('401s without a user', async () => {
    strictEqual((await call(folders, '/uploads/folders', {}, { json: { name: 'x' } })).status, 401);
  });
});
