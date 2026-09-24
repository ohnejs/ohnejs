import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { useEnv } from '../../../src/ohne/env/use-env.ts';
import { HTTPError } from '../../../src/ohne/http/http-error.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { createFolder } from '../../../src/uploads/uploads/create-folder.ts';
import { deleteUploads } from '../../../src/uploads/uploads/delete-uploads.ts';
import { putUpload } from '../../../src/uploads/uploads/put-upload.ts';
import { updateUpload } from '../../../src/uploads/uploads/update-upload.ts';
import { bytes, storage, stream } from '../_fixture.ts';

useEnv().set('UPLOADS_SECRET', 'secret');

async function put(directory: string, name: string): Promise<string> {
  const upload = await putUpload({ directory, name, body: stream(bytes(name)) });
  return upload.UUID;
}

function objects(prefix: string): string[] {
  return [...storage.objects.keys()].filter((key) => key.startsWith(prefix)).sort();
}

function notFound(error: unknown): boolean {
  return error instanceof HTTPError && error.status === 404;
}

describe('deleteUploads', () => {
  it('removes every row and its object', async () => {
    const one = await put('many', 'one.txt');
    const two = await put('many/sub', 'two.txt');
    await put('many', 'kept.txt');
    await deleteUploads([one, two, one]);
    strictEqual(
      await queryUntyped('Uploads')
        .where({ UUID: { in: [one, two] } })
        .count(),
      0,
    );
    deepStrictEqual(objects('many/'), ['many/kept.txt']);
    strictEqual(await queryUntyped('UploadsJournal').count(), 0);
  });

  it('removes a folder with its subtree, a named row inside it included', async () => {
    const folder = await createFolder({ directory: 'nest', name: 'box' });
    const inner = await put('nest/box/deep', 'inner.txt');
    await put('nest/boxes', 'sibling.txt');
    await deleteUploads([inner, folder.UUID]);
    strictEqual(await queryUntyped('Uploads').where({ UUID: inner }).exists(), false);
    strictEqual(await queryUntyped('Uploads').where({ directory: 'nest/box/deep' }).count(), 0);
    deepStrictEqual(objects('nest/'), ['nest/boxes/sibling.txt']);
  });

  it('404s an unknown UUID and one its reach hides, deleting nothing', async () => {
    const seen = await put('hold', 'seen.txt');
    const hidden = await put('hold', 'hidden.txt');
    await updateUpload(hidden, { private: true });
    await rejects(deleteUploads([seen, 'missing']), notFound);
    await rejects(
      deleteUploads([seen, hidden], { reach: { where: { private: false } } }),
      notFound,
    );
    deepStrictEqual(objects('hold/'), ['hold/hidden.txt', 'hold/seen.txt']);
    strictEqual(
      await queryUntyped('Uploads')
        .where({ UUID: { in: [seen, hidden] } })
        .count(),
      2,
    );
    strictEqual(await queryUntyped('UploadsJournal').count(), 0);
  });
});
