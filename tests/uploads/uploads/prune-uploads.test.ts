import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { UploadRecord } from '../../../src/uploads/uploads/types.ts';

import { isOhneError } from '../../../src/ohne/error/ohne-error.ts';
import { hook } from '../../../src/ohne/hooks/hook.ts';
import { useHooks } from '../../../src/ohne/hooks/use-hooks.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { drainJournal } from '../../../src/uploads/storage/journal.ts';
import { moveUpload } from '../../../src/uploads/uploads/move-upload.ts';
import { pruneUploads } from '../../../src/uploads/uploads/prune-uploads.ts';
import { putUpload } from '../../../src/uploads/uploads/put-upload.ts';
import { bytes, storage, stream } from '../_fixture.ts';

function put(directory: string, name: string): Promise<UploadRecord> {
  return putUpload({ directory, name, body: stream(bytes(name)) });
}

function within(prefix: string, paths: readonly string[]): string[] {
  return paths.filter((path) => path.startsWith(`${prefix}/`));
}

describe('pruneUploads', () => {
  it('lists the objects no row names and leaves them in place', async () => {
    await put('report', 'kept.txt');
    storage.objects.set('report/stray.txt', bytes('stray'));
    storage.objects.set('report/deep/lost.txt', bytes('lost'));
    storage.objects.set('.tmp/report-staged', bytes('staged'));

    deepStrictEqual(within('report', await pruneUploads()), [
      'report/deep/lost.txt',
      'report/stray.txt',
    ]);
    strictEqual(storage.objects.has('report/stray.txt'), true);
  });

  it('deletes the orphans with `delete`, keeping every named object', async () => {
    await put('clean', 'kept.txt');
    storage.objects.set('clean/stray.txt', bytes('stray'));
    storage.objects.set('.tmp/clean-staged', bytes('staged'));

    const deleted = await pruneUploads({ delete: true });

    deepStrictEqual(within('clean', deleted), ['clean/stray.txt']);
    strictEqual(deleted.includes('.tmp/clean-staged'), false);
    strictEqual(storage.objects.has('clean/stray.txt'), false);
    strictEqual(storage.objects.has('clean/kept.txt'), true);
    strictEqual(storage.objects.has('.tmp/clean-staged'), true);
    storage.objects.delete('.tmp/clean-staged');
    strictEqual(await queryUntyped('UploadsJournal').count(), 0);
    deepStrictEqual(await pruneUploads(), []);
  });

  it('never takes an object at a folder above a named file, since its delete would carry that file', async () => {
    await put('wrap', 'inner.txt');
    storage.objects.set('wrap', bytes('shadow'));

    deepStrictEqual(await pruneUploads({ delete: true }), []);
    strictEqual(storage.objects.has('wrap/inner.txt'), true);
    storage.objects.delete('wrap');
  });

  it('counts a named file listed under a folder spelled in capitals', async () => {
    await put('cased', 'file.txt');
    storage.objects.set('Cased/file.txt', storage.objects.get('cased/file.txt')!);
    storage.objects.delete('cased/file.txt');

    deepStrictEqual(await pruneUploads({ delete: true }), []);
    strictEqual(storage.objects.has('Cased/file.txt'), true);
    storage.objects.delete('Cased/file.txt');
  });

  it('keeps the bytes of a row a query:filter scope hides', async () => {
    await put('scoped', 'hidden.txt');
    hook('query:filter', (ir) => (ir.collection === 'Uploads' ? { ...ir, limit: 0 } : ir));
    try {
      deepStrictEqual(await pruneUploads({ delete: true }), []);
    } finally {
      useHooks().clear();
    }
    strictEqual(storage.objects.has('scoped/hidden.txt'), true);
  });

  it('keeps the bytes of a row a query:records hook drops', async () => {
    await put('rec', 'live.txt');
    hook('query:records', (records, { collection }) =>
      collection === 'Uploads' ? records.filter((row) => row.name !== 'live.txt') : records,
    );
    try {
      strictEqual((await pruneUploads({ delete: true })).includes('rec/live.txt'), false);
    } finally {
      useHooks().clear();
    }
    strictEqual(storage.objects.has('rec/live.txt'), true);
  });

  it('skips a path a pending journal entry still touches', async () => {
    storage.objects.set('held/old.txt', bytes('old'));
    await queryUntyped('UploadsJournal').createOrThrow({
      sequence: 1,
      op: 'move',
      from: 'held/old.txt',
      to: 'held/new.txt',
    });
    storage.failNext('move');

    deepStrictEqual(within('held', await pruneUploads()), []);
    strictEqual(await drainJournal(), true);
    deepStrictEqual(within('held', await pruneUploads()), ['held/new.txt']);
    await pruneUploads({ delete: true });
  });

  it('holds a stored key whose pending entry differs only in case', async () => {
    const { UUID } = await put('case', 'a.txt');
    storage.objects.set('Case/a.txt', storage.objects.get('case/a.txt')!);
    storage.objects.delete('case/a.txt');
    storage.failNext('move');
    await moveUpload(UUID, { directory: 'archive' });
    storage.failNext('move');

    strictEqual((await pruneUploads({ delete: true })).includes('Case/a.txt'), false);
    strictEqual(storage.objects.has('Case/a.txt'), true);
    strictEqual(await drainJournal(), true);
    storage.objects.delete('Case/a.txt');
  });

  it('leaves alone a key no row could name', async () => {
    const keys = ['dots/..', 'dots/./x', 'dots//x', 'dots/', ''];
    for (const key of keys) storage.objects.set(key, bytes('odd'));

    const deleted = await pruneUploads({ delete: true });

    deepStrictEqual(
      keys.filter((key) => deleted.includes(key)),
      [],
    );
    deepStrictEqual(
      keys.filter((key) => !storage.objects.has(key)),
      [],
    );
    strictEqual(await drainJournal(), true);
    for (const key of keys) storage.objects.delete(key);
  });

  it('refuses a storage that cannot list its objects', async () => {
    const { list } = storage;
    storage.list = undefined;
    try {
      await rejects(pruneUploads(), isOhneError);
    } finally {
      storage.list = list;
    }
  });
});
