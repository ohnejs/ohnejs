import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { useEnv } from '../../../../src/ohne/env/use-env.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';
import { useRoles } from '../../../../src/ohne/roles/use-roles.ts';
import foldersPost from '../../../../src/uploads/api/uploads/folders.post.ts';
import { call, errorsOf, route, storage, userWith, withReadAccess } from '../../_fixture.ts';

useEnv().set('UPLOADS_SECRET', 'secret');

const folders = route('POST', '/uploads/folders', foldersPost);
const admin = await userWith('admin@example.com', ['uploads-admin']);
useRoles().register('uploads-creator', {
  name: 'uploads-creator',
  role: { capabilities: ['collection.Uploads.create'] },
});
const creator = await userWith('creator@example.com', ['uploads-creator']);

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

  it('422s a folder the read access scope would hide, creating nothing', async () => {
    await queryUntyped('Uploads').createOrThrow({
      kind: 'folder',
      directory: '',
      name: 'locked',
      private: true,
    });
    await withReadAccess(
      () => ({ where: { private: false } }),
      async () => {
        const response = await call(
          folders,
          '/uploads/folders',
          {},
          { bearer: admin, json: { directory: 'locked/deep', name: 'inner' } },
        );
        strictEqual(response.status, 422);
        strictEqual(errorsOf(await response.json())[''], 'uploads.errors.outOfReach');
      },
    );
    const inside = { directory: { startsWith: 'locked' } };
    strictEqual(await queryUntyped('Uploads').where(inside).count(), 0);
  });

  it('422s a creator whose public read scope would hide the folder', async () => {
    await withReadAccess(
      () => ({ where: { private: false } }),
      async () => {
        const response = await call(
          folders,
          '/uploads/folders',
          {},
          { bearer: creator, json: { directory: 'locked', name: 'public' } },
        );
        strictEqual(response.status, 422);
        strictEqual(errorsOf(await response.json())[''], 'uploads.errors.outOfReach');
      },
      true,
    );
    strictEqual(await queryUntyped('Uploads').where({ name: 'public' }).count(), 0);
  });
});
