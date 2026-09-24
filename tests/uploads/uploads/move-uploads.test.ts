import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { useEnv } from '../../../src/ohne/env/use-env.ts';
import { HTTPError } from '../../../src/ohne/http/http-error.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { isValidationError } from '../../../src/ohne/query/write/errors.ts';
import { createFolder } from '../../../src/uploads/uploads/create-folder.ts';
import { moveUploads } from '../../../src/uploads/uploads/move-uploads.ts';
import { putUpload } from '../../../src/uploads/uploads/put-upload.ts';
import { updateUpload } from '../../../src/uploads/uploads/update-upload.ts';
import { bytes, storage, stream, text } from '../_fixture.ts';

useEnv().set('UPLOADS_SECRET', 'secret');

async function put(directory: string, name: string): Promise<string> {
  const upload = await putUpload({ directory, name, body: stream(bytes(name)) });
  return upload.UUID;
}

async function pathOf(uuid: string): Promise<string> {
  const row = await queryUntyped('Uploads').where({ UUID: uuid }).findFirst();
  return `${row?.directory}/${row?.name}`;
}

function refusedWith(error: string): (error: unknown) => boolean {
  return (caught) => isValidationError(caught) && Object.values(caught.errors).includes(error);
}

describe('moveUploads', () => {
  it('moves every row and its object, answering the records in the order given', async () => {
    const a = await put('bulk', 'a.txt');
    const b = await put('bulk/in', 'b.txt');
    const records = await moveUploads([b, a, b], 'Bulk/Out');
    deepStrictEqual(
      records.map((record) => record.path),
      ['bulk/out/b.txt', 'bulk/out/a.txt'],
    );
    strictEqual(text(storage.objects.get('bulk/out/a.txt')), 'a.txt');
    strictEqual(text(storage.objects.get('bulk/out/b.txt')), 'b.txt');
    strictEqual(storage.objects.has('bulk/a.txt'), false);
    strictEqual(await queryUntyped('UploadsJournal').count(), 0);
  });

  it('leaves a row already in the directory where it is', async () => {
    const there = await put('stay/here', 'there.txt');
    const away = await put('stay', 'away.txt');
    const records = await moveUploads([there, away], 'stay/here');
    deepStrictEqual(
      records.map((record) => record.path),
      ['stay/here/there.txt', 'stay/here/away.txt'],
    );
  });

  it('carries a named row inside a moving folder along with it', async () => {
    const folder = await createFolder({ directory: 'tree', name: 'box' });
    const inner = await put('tree/box/deep', 'inner.txt');
    await moveUploads([inner, folder.UUID], 'moved');
    strictEqual(await pathOf(folder.UUID), 'moved/box');
    strictEqual(await pathOf(inner), 'moved/box/deep/inner.txt');
    strictEqual(text(storage.objects.get('moved/box/deep/inner.txt')), 'inner.txt');
  });

  it('carries a named row inside a moving folder along under a scoped reach', async () => {
    const folder = await createFolder({ directory: 'scoped', name: 'box' });
    const inner = await put('scoped/box', 'x.txt');
    await moveUploads([folder.UUID, inner], 'landed', { reach: { where: { private: false } } });
    strictEqual(await pathOf(folder.UUID), 'landed/box');
    strictEqual(await pathOf(inner), 'landed/box/x.txt');
  });

  it('moves a named row out of a named folder that stays', async () => {
    const folder = await createFolder({ directory: 'keep', name: 'box' });
    const inner = await put('keep/box', 'out.txt');
    await moveUploads([folder.UUID, inner], 'keep');
    strictEqual(await pathOf(folder.UUID), 'keep/box');
    strictEqual(await pathOf(inner), 'keep/out.txt');
  });

  it('422s a folder moved into itself, moving nothing', async () => {
    const file = await put('self', 'file.txt');
    const folder = await createFolder({ directory: 'self', name: 'loop' });
    await rejects(
      moveUploads([file, folder.UUID], 'self/loop/deeper'),
      refusedWith('uploads.errors.folderIntoItself'),
    );
    strictEqual(await pathOf(file), 'self/file.txt');
    strictEqual(text(storage.objects.get('self/file.txt')), 'file.txt');
    strictEqual(await queryUntyped('Uploads').where({ directory: 'self/loop' }).exists(), false);
    strictEqual(await queryUntyped('UploadsJournal').count(), 0);
  });

  it('rolls every row back when one target is taken', async () => {
    const first = await put('clash/one', 'same.txt');
    const second = await put('clash/two', 'same.txt');
    await rejects(moveUploads([first, second], 'clash'), isValidationError);
    strictEqual(await pathOf(first), 'clash/one/same.txt');
    strictEqual(await pathOf(second), 'clash/two/same.txt');
    strictEqual(storage.objects.has('clash/same.txt'), false);
    strictEqual(await queryUntyped('UploadsJournal').count(), 0);
  });

  it('404s an unknown UUID and one its reach hides, moving nothing', async () => {
    const known = await put('gone', 'known.txt');
    const hidden = await put('gone', 'hidden.txt');
    await updateUpload(hidden, { private: true });
    const reach = { where: { private: false } };
    const notFound = (error: unknown) => error instanceof HTTPError && error.status === 404;
    await rejects(moveUploads([known, 'missing'], 'elsewhere'), notFound);
    await rejects(moveUploads([known, hidden], 'elsewhere', { reach }), notFound);
    strictEqual(await pathOf(known), 'gone/known.txt');
    strictEqual(await pathOf(hidden), 'gone/hidden.txt');
  });

  it('422s a move that would hide a moved row from its reach, moving nothing', async () => {
    const folder = await createFolder({ directory: 'r', name: 'tmp' });
    const inner = await put('r/tmp', 'a.txt');
    const reach = { where: { directory: { in: ['r', 'r/tmp'] } } };
    await rejects(
      moveUploads([folder.UUID], 'r/sub', { reach }),
      refusedWith('uploads.errors.outOfReach'),
    );
    strictEqual(await pathOf(inner), 'r/tmp/a.txt');
    strictEqual(
      await queryUntyped('Uploads').where({ directory: 'r', name: 'sub' }).exists(),
      false,
    );
  });
});
