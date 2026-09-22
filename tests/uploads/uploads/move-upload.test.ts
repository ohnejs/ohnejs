import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { HTTPError } from '../../../src/ohne/http/http-error.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { isValidationError } from '../../../src/ohne/query/write/errors.ts';
import { moveUpload } from '../../../src/uploads/uploads/move-upload.ts';
import { putUpload } from '../../../src/uploads/uploads/put-upload.ts';
import { updateUpload } from '../../../src/uploads/uploads/update-upload.ts';
import { bytes, storage, stream, text } from '../_fixture.ts';

async function put(directory: string, name: string, content: string): Promise<string> {
  const upload = await putUpload({ directory, name, body: stream(bytes(content)) });
  return upload.UUID;
}

async function folderUUID(directory: string, name: string): Promise<string> {
  const row = await queryUntyped('Uploads').where({ directory, name, kind: 'folder' }).findFirst();
  ok(row);
  return row.UUID as string;
}

async function paths(prefix: string): Promise<string[]> {
  const rows = await queryUntyped('Uploads')
    .whereAny((g) => [
      g.where({ directory: prefix }),
      g.where({ directory: { startsWith: `${prefix}/` } }),
    ])
    .findMany();
  return rows.map((row) => `${row.directory}/${row.name}`).sort();
}

async function privacy(prefix: string): Promise<Record<string, unknown>> {
  const rows = await queryUntyped('Uploads')
    .whereAny((g) => [
      g.where({ directory: prefix }),
      g.where({ directory: { startsWith: `${prefix}/` } }),
    ])
    .findMany();
  return Object.fromEntries(rows.map((row) => [`${row.directory}/${row.name}`, row.private]));
}

async function privateFolder(directory: string, name: string): Promise<void> {
  await queryUntyped('Uploads').createOrThrow({ kind: 'folder', directory, name, private: true });
}

function objects(prefix: string): string[] {
  return [...storage.objects.keys()].filter((key) => key.startsWith(prefix)).sort();
}

async function failure(run: () => Promise<unknown>): Promise<Record<string, unknown>> {
  let caught: unknown;
  await rejects(run, (error: unknown) => {
    caught = error;
    return isValidationError(error);
  });
  return (caught as { errors: Record<string, unknown> }).errors;
}

describe('moveUpload', () => {
  it('renames a file, moving its object and canonicalizing the name', async () => {
    const uuid = await put('rename', 'a.txt', 'one');
    const moved = await moveUpload(uuid, { name: 'B Renamed.TXT' });
    strictEqual(moved.name, 'b-renamed.txt');
    strictEqual(moved.path, 'rename/b-renamed.txt');
    strictEqual(text(storage.objects.get('rename/b-renamed.txt')), 'one');
    strictEqual(storage.objects.has('rename/a.txt'), false);
    strictEqual(await queryUntyped('UploadsJournal').count(), 0);
  });

  it('moves a file into another directory, creating the folders on the way', async () => {
    const uuid = await put('from', 'deep.txt', 'd');
    const moved = await moveUpload(uuid, { directory: 'to/deeper/still' });
    strictEqual(moved.path, 'to/deeper/still/deep.txt');
    strictEqual(text(storage.objects.get('to/deeper/still/deep.txt')), 'd');
    ok(await queryUntyped('Uploads').where({ directory: 'to/deeper', name: 'still' }).exists());
  });

  it('keeps a file extension', async () => {
    const uuid = await put('ext', 'keep.txt', 'k');
    const errors = await failure(() => moveUpload(uuid, { name: 'keep.md' }));
    deepStrictEqual(errors, { name: 'uploads.errors.extensionChange' });
    strictEqual(text(storage.objects.get('ext/keep.txt')), 'k');
  });

  it('moves a folder, rewriting every descendant and the object prefix', async () => {
    await put('tree/a', 'one.txt', '1');
    await put('tree/a/b', 'two.txt', '2');
    const uuid = await folderUUID('tree', 'a');

    const moved = await moveUpload(uuid, { directory: 'tree/moved', name: 'x' });
    strictEqual(moved.path, 'tree/moved/x');
    deepStrictEqual(await paths('tree'), [
      'tree/moved',
      'tree/moved/x',
      'tree/moved/x/b',
      'tree/moved/x/b/two.txt',
      'tree/moved/x/one.txt',
    ]);
    deepStrictEqual(objects('tree/'), ['tree/moved/x/b/two.txt', 'tree/moved/x/one.txt']);
    strictEqual(text(storage.objects.get('tree/moved/x/b/two.txt')), '2');
  });

  it('refuses to move a folder into itself', async () => {
    await put('self/a/b', 'leaf.txt', 'l');
    const uuid = await folderUUID('self', 'a');
    for (const directory of ['self/a', 'self/a/b']) {
      const errors = await failure(() => moveUpload(uuid, { directory }));
      deepStrictEqual(errors, { directory: 'uploads.errors.folderIntoItself' });
    }
    deepStrictEqual(objects('self/'), ['self/a/b/leaf.txt']);
  });

  it('answers the record untouched when nothing changes', async () => {
    const uuid = await put('same', 'still.txt', 's');
    const unchanged = await moveUpload(uuid, { directory: 'Same/', name: 'Still.TXT' });
    strictEqual(unchanged.path, 'same/still.txt');
    strictEqual(await queryUntyped('UploadsJournal').count(), 0);
  });

  it('locks a file moved into a private folder', async () => {
    await privateFolder('lock', 'vault');
    const uuid = await put('lock', 'in.txt', 'i');
    const moved = await moveUpload(uuid, { directory: 'lock/vault' });
    strictEqual(moved.private, true);
    strictEqual(storage.visibility.get('lock/vault/in.txt'), true);
    strictEqual(await queryUntyped('UploadsJournal').count(), 0);
  });

  it('locks a folder moved into a private one, with everything inside it', async () => {
    await put('cascade/src', 'one.txt', '1');
    await put('cascade/src/sub', 'two.txt', '2');
    await privateFolder('cascade', 'vault');
    const uuid = await folderUUID('cascade', 'src');
    const moved = await moveUpload(uuid, { directory: 'cascade/vault' });
    strictEqual(moved.private, true);
    deepStrictEqual(await privacy('cascade/vault'), {
      'cascade/vault/src': true,
      'cascade/vault/src/one.txt': true,
      'cascade/vault/src/sub': true,
      'cascade/vault/src/sub/two.txt': true,
    });
    strictEqual(storage.visibility.get('cascade/vault/src/one.txt'), true);
    strictEqual(storage.visibility.get('cascade/vault/src/sub/two.txt'), true);
    strictEqual(await queryUntyped('UploadsJournal').count(), 0);
  });

  it('leaves a public file public when renamed inside a private folder', async () => {
    await privateFolder('rename-in', 'vault');
    const uuid = await put('rename-in/vault', 'brochure.txt', 'b');
    await updateUpload(uuid, { private: false });
    const renamed = await moveUpload(uuid, { name: 'brochure-2026.txt' });
    strictEqual(renamed.path, 'rename-in/vault/brochure-2026.txt');
    strictEqual(renamed.private, false);
    strictEqual(storage.visibility.get('rename-in/vault/brochure-2026.txt'), false);
    strictEqual(await queryUntyped('UploadsJournal').count(), 0);
  });

  it('leaves a public folder and its subtree public when renamed inside a private folder', async () => {
    await privateFolder('rename-tree', 'vault');
    await put('rename-tree/vault/open', 'one.txt', '1');
    const uuid = await folderUUID('rename-tree/vault', 'open');
    await updateUpload(uuid, { private: false });
    await moveUpload(uuid, { name: 'shared' });
    deepStrictEqual(await privacy('rename-tree/vault'), {
      'rename-tree/vault/shared': false,
      'rename-tree/vault/shared/one.txt': false,
    });
  });

  it('keeps a private file private when moved out', async () => {
    await privateFolder('keep', 'vault');
    const uuid = await put('keep/vault', 'stay.txt', 's');
    const moved = await moveUpload(uuid, { directory: 'keep' });
    strictEqual(moved.path, 'keep/stay.txt');
    strictEqual(moved.private, true);
    strictEqual(await queryUntyped('UploadsJournal').count(), 0);
    strictEqual(storage.visibility.get('keep/stay.txt'), true);
  });

  it('404s an unknown UUID', async () => {
    await rejects(
      moveUpload('missing', { name: 'x.txt' }),
      (error: unknown) => error instanceof HTTPError && error.status === 404,
    );
  });
});
