import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { isValidationError } from '../../../src/ohne/query/write/errors.ts';
import { createFolder } from '../../../src/uploads/uploads/create-folder.ts';
import { storage } from '../_fixture.ts';

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

  it('refuses a name already taken in the directory', async () => {
    await createFolder({ directory: 'dup', name: 'twice' });
    await rejects(createFolder({ directory: 'dup', name: 'Twice' }), (error: unknown) => {
      return isValidationError(error) && error.errors.name === 'validation.notUnique';
    });
  });
});
