import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { useEnv } from '../../../src/ohne/env/use-env.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { isValidationError } from '../../../src/ohne/query/write/errors.ts';
import { patchUpload } from '../../../src/uploads/uploads/_patch.ts';
import { createFolder } from '../../../src/uploads/uploads/create-folder.ts';
import { putUpload } from '../../../src/uploads/uploads/put-upload.ts';
import { bytes, storage, stream, text } from '../_fixture.ts';

const reach = { where: { directory: { in: ['r', 'r/tmp'] } } };

describe('patchUpload', () => {
  it('422s a folder rename that moves a reached row out of reach', async () => {
    const folder = await createFolder({ directory: 'r', name: 'tmp' });
    const inner = await putUpload({ directory: 'r/tmp', name: 'a.txt', body: stream(bytes('a')) });
    await rejects(
      patchUpload(folder.UUID, { target: { name: 'kept' } }, { reach }),
      (error: unknown) =>
        isValidationError(error) && error.errors[''] === 'uploads.errors.outOfReach',
    );
    const row = await queryUntyped('Uploads').where({ UUID: inner.UUID }).findFirst();
    strictEqual(row?.directory, 'r/tmp');
    strictEqual(text(storage.objects.get('r/tmp/a.txt')), 'a');
  });

  it('writes unscoped without a reach', async () => {
    const folder = await createFolder({ directory: 'r', name: 'free' });
    await putUpload({ directory: 'r/free', name: 'b.txt', body: stream(bytes('b')) });
    const record = await patchUpload(folder.UUID, { target: { name: 'moved' } });
    strictEqual(record.path, 'r/moved');
    strictEqual(text(storage.objects.get('r/moved/b.txt')), 'b');
  });

  it('422s a move into a private folder with private false, creating and moving nothing', async () => {
    useEnv().set('UPLOADS_SECRET', 'secret');
    try {
      await queryUntyped('Uploads').createOrThrow({
        kind: 'folder',
        directory: 'x',
        name: 'vault',
        private: true,
      });
      const file = await putUpload({ directory: 'x', name: 'c.txt', body: stream(bytes('c')) });
      await rejects(
        patchUpload(file.UUID, {
          target: { directory: 'x/vault/new' },
          changes: { private: false },
        }),
        (error: unknown) => {
          if (!isValidationError(error)) return false;
          deepStrictEqual(error.errors, {
            private: {
              key: 'uploads.errors.insidePrivateFolder',
              params: { folder: 'x/vault/new' },
            },
          });
          return true;
        },
      );
      const row = await queryUntyped('Uploads').where({ UUID: file.UUID }).findFirst();
      strictEqual(row?.directory, 'x');
      strictEqual(row?.private, false);
      strictEqual(
        await queryUntyped('Uploads').where({ directory: 'x/vault', name: 'new' }).exists(),
        false,
      );
      strictEqual(text(storage.objects.get('x/c.txt')), 'c');
      strictEqual(storage.objects.has('x/vault/new/c.txt'), false);
    } finally {
      useEnv().unset('UPLOADS_SECRET');
    }
  });
});
