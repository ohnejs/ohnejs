import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { useEnv } from '../../../src/ohne/env/use-env.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { isValidationError } from '../../../src/ohne/query/write/errors.ts';
import { createFolder } from '../../../src/uploads/uploads/create-folder.ts';
import { storage } from '../_fixture.ts';

useEnv().set('UPLOADS_SECRET', 'secret');

describe('createFolder', () => {
  it('creates the folder row and its ancestors, touching no storage', async () => {
    const before = storage.objects.size;
    const folder = await createFolder({ directory: 'Library/Photos', name: 'Summer 2024' });
    strictEqual(folder.kind, 'folder');
    strictEqual(folder.directory, 'library/photos');
    strictEqual(folder.name, 'summer-2024');
    strictEqual(folder.path, 'library/photos/summer-2024');
    strictEqual(folder.url, undefined);
    strictEqual(folder.type, null);
    strictEqual(folder.size, null);
    strictEqual(folder.hash, null);

    const rows = await queryUntyped('Uploads').where({ kind: 'folder' }).findMany();
    const paths = rows.map((row) => [row.directory, row.name].filter(Boolean).join('/'));
    deepStrictEqual(paths.filter((path) => path.startsWith('library')).sort(), [
      'library',
      'library/photos',
      'library/photos/summer-2024',
    ]);
    strictEqual(storage.objects.size, before);
    strictEqual(await queryUntyped('UploadsJournal').count(), 0);
  });

  it('records the author', async () => {
    const user = await queryUntyped('Users').createOrThrow({
      email: 'author@example.com',
      password: 'pw-123456',
    });
    const folder = await createFolder({ directory: '', name: 'mine', author: user.UUID as string });
    strictEqual(folder.author, user.UUID);
  });

  it('is born private inside a private folder, with the ancestors it implies', async () => {
    await queryUntyped('Uploads').createOrThrow({
      kind: 'folder',
      directory: '',
      name: 'sealed',
      private: true,
    });
    const folder = await createFolder({ directory: 'sealed/a/b', name: 'c' });
    strictEqual(folder.private, true);
    const rows = await queryUntyped('Uploads')
      .where({ directory: { startsWith: 'sealed' } })
      .findMany();
    deepStrictEqual(
      Object.fromEntries(rows.map((row) => [`${row.directory}/${row.name}`, row.private])),
      { 'sealed/a': true, 'sealed/a/b': true, 'sealed/a/b/c': true },
    );
    const open = await createFolder({ directory: 'unsealed', name: 'd' });
    strictEqual(open.private, false);
    strictEqual(await queryUntyped('UploadsJournal').count(), 0);
  });

  it('refuses a name already taken in the directory', async () => {
    await createFolder({ directory: 'dup', name: 'twice' });
    await rejects(createFolder({ directory: 'dup', name: 'Twice' }), (error: unknown) => {
      return isValidationError(error) && error.errors.name === 'validation.notUnique';
    });
  });
});
