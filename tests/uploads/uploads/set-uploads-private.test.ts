import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { useEnv } from '../../../src/ohne/env/use-env.ts';
import { HTTPError } from '../../../src/ohne/http/http-error.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { isValidationError } from '../../../src/ohne/query/write/errors.ts';
import { createFolder } from '../../../src/uploads/uploads/create-folder.ts';
import { putUpload } from '../../../src/uploads/uploads/put-upload.ts';
import { setUploadsPrivate } from '../../../src/uploads/uploads/set-uploads-private.ts';
import { updateUpload } from '../../../src/uploads/uploads/update-upload.ts';
import { bytes, storage, stream } from '../_fixture.ts';

useEnv().set('UPLOADS_SECRET', 'secret');

async function put(directory: string, name: string): Promise<string> {
  const upload = await putUpload({ directory, name, body: stream(bytes(name)) });
  return upload.UUID;
}

async function privacy(uuids: string[]): Promise<unknown[]> {
  const rows = await queryUntyped('Uploads')
    .where({ UUID: { in: uuids } })
    .findMany();
  return uuids.map((uuid) => rows.find((row) => row.UUID === uuid)?.private);
}

function refusedWith(error: string): (error: unknown) => boolean {
  return (caught) =>
    isValidationError(caught) &&
    Object.values(caught.errors).some(
      (message) => message === error || (message as { key?: string }).key === error,
    );
}

describe('setUploadsPrivate', () => {
  it('locks every row and its object, answering the records in the order given', async () => {
    const a = await put('lock', 'a.txt');
    const b = await put('lock', 'b.txt');
    const records = await setUploadsPrivate([b, a, b], true);
    deepStrictEqual(
      records.map((record) => [record.path, record.private]),
      [
        ['lock/b.txt', true],
        ['lock/a.txt', true],
      ],
    );
    strictEqual(storage.visibility.get('lock/a.txt'), true);
    strictEqual(storage.visibility.get('lock/b.txt'), true);
    strictEqual(await queryUntyped('UploadsJournal').count(), 0);
  });

  it('unlocks a folder before a named row inside it', async () => {
    const folder = await createFolder({ directory: 'open', name: 'box' });
    const inner = await put('open/box', 'inner.txt');
    await updateUpload(folder.UUID, { private: true });
    const records = await setUploadsPrivate([inner, folder.UUID], false);
    deepStrictEqual(
      records.map((record) => record.private),
      [false, false],
    );
    strictEqual(storage.visibility.get('open/box/inner.txt'), false);
  });

  it('locks a named row inside a named folder under a scoped reach', async () => {
    const folder = await createFolder({ directory: 'nest', name: 'box' });
    const inner = await put('nest/box', 'x.txt');
    const reach = { where: { directory: { startsWith: 'nest' } } };
    await setUploadsPrivate([folder.UUID, inner], true, { reach });
    deepStrictEqual(await privacy([folder.UUID, inner]), [true, true]);
  });

  it('422s a row made public inside a private folder, changing nothing', async () => {
    const free = await put('pin', 'free.txt');
    await updateUpload(free, { private: true });
    const vault = await createFolder({ directory: 'pin', name: 'vault' });
    const inner = await put('pin/vault', 'inner.txt');
    await updateUpload(vault.UUID, { private: true });
    await rejects(
      setUploadsPrivate([free, inner], false),
      refusedWith('uploads.errors.insidePrivateFolder'),
    );
    deepStrictEqual(await privacy([free, inner]), [true, true]);
    strictEqual(storage.visibility.get('pin/free.txt'), true);
    strictEqual(await queryUntyped('UploadsJournal').count(), 0);
  });

  it('404s an unknown UUID and one its reach hides, changing nothing', async () => {
    const seen = await put('hide', 'seen.txt');
    const hidden = await put('hide', 'hidden.txt');
    await updateUpload(hidden, { private: true });
    const notFound = (error: unknown) => error instanceof HTTPError && error.status === 404;
    const reach = { where: { private: false } };
    await rejects(setUploadsPrivate([seen, 'missing'], true), notFound);
    await rejects(setUploadsPrivate([seen, hidden], false, { reach }), notFound);
    deepStrictEqual(await privacy([seen, hidden]), [false, true]);
  });

  it('422s a lock that would hide a row from its reach, changing nothing', async () => {
    const a = await put('shy', 'a.txt');
    const b = await put('shy', 'b.txt');
    await rejects(
      setUploadsPrivate([a, b], true, { reach: { where: { private: false } } }),
      refusedWith('uploads.errors.outOfReach'),
    );
    deepStrictEqual(await privacy([a, b]), [false, false]);
    strictEqual(storage.visibility.has('shy/a.txt'), false);
  });

  it('changes nothing while no secret makes the layer keep private files', async () => {
    const plain = await put('nosecret', 'plain.txt');
    useEnv().unset('UPLOADS_SECRET');
    try {
      const [record] = await setUploadsPrivate([plain], true);
      strictEqual(record?.private, false);
    } finally {
      useEnv().set('UPLOADS_SECRET', 'secret');
    }
  });
});
