import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { useEnv } from '../../../src/ohne/env/use-env.ts';
import { HTTPError } from '../../../src/ohne/http/http-error.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { deleteUpload } from '../../../src/uploads/uploads/delete-upload.ts';
import { putUpload } from '../../../src/uploads/uploads/put-upload.ts';
import { updateUpload } from '../../../src/uploads/uploads/update-upload.ts';
import { bytes, storage, stream } from '../_fixture.ts';

useEnv().set('UPLOADS_SECRET', 'secret');

async function put(directory: string, name: string): Promise<string> {
  const upload = await putUpload({ directory, name, body: stream(bytes(name)) });
  return upload.UUID;
}

async function count(prefix: string): Promise<number> {
  return queryUntyped('Uploads')
    .whereAny((g) => [
      g.where({ directory: prefix }),
      g.where({ directory: { startsWith: `${prefix}/` } }),
    ])
    .count();
}

function objects(prefix: string): string[] {
  return [...storage.objects.keys()].filter((key) => key.startsWith(prefix)).sort();
}

describe('deleteUpload', () => {
  it('removes a file row and its object', async () => {
    const uuid = await put('gone', 'one.txt');
    await put('gone', 'two.txt');
    await deleteUpload(uuid);
    strictEqual(await queryUntyped('Uploads').where({ UUID: uuid }).exists(), false);
    deepStrictEqual(objects('gone/'), ['gone/two.txt']);
    strictEqual(await queryUntyped('UploadsJournal').count(), 0);
  });

  it('removes a folder with its whole subtree, rows and objects', async () => {
    await put('sub/a', 'one.txt');
    await put('sub/a/b/c', 'two.txt');
    await put('sub/aa', 'sibling.txt');
    const folder = await queryUntyped('Uploads').where({ directory: 'sub', name: 'a' }).findFirst();
    ok(folder);

    await deleteUpload(folder.UUID as string);
    strictEqual(await count('sub/a'), 0);
    strictEqual(await queryUntyped('Uploads').where({ UUID: folder.UUID }).exists(), false);
    strictEqual(await count('sub/aa'), 1);
    deepStrictEqual(objects('sub/'), ['sub/aa/sibling.txt']);
  });

  it('404s an unknown UUID and a repeat', async () => {
    const uuid = await put('twice', 'once.txt');
    await deleteUpload(uuid);
    for (const missing of [uuid, 'nope']) {
      await rejects(
        deleteUpload(missing),
        (error: unknown) => error instanceof HTTPError && error.status === 404,
      );
    }
  });

  it('404s a row its reach hides, keeping it', async () => {
    const uuid = await put('reach', 'hidden.txt');
    await updateUpload(uuid, { private: true });
    await rejects(
      deleteUpload(uuid, { reach: { where: { private: false } } }),
      (error: unknown) => error instanceof HTTPError && error.status === 404,
    );
    strictEqual(await queryUntyped('Uploads').where({ UUID: uuid }).exists(), true);
    deepStrictEqual(objects('reach/'), ['reach/hidden.txt']);
  });
});
