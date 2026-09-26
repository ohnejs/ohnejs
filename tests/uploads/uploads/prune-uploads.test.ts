import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { UploadRecord } from '../../../src/uploads/uploads/types.ts';

import { isOhneError } from '../../../src/ohne/error/ohne-error.ts';
import { hook } from '../../../src/ohne/hooks/hook.ts';
import { useHooks } from '../../../src/ohne/hooks/use-hooks.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { drainJournal } from '../../../src/uploads/storage/journal.ts';
import { createUploadSession } from '../../../src/uploads/uploads/create-upload-session.ts';
import { deleteUpload } from '../../../src/uploads/uploads/delete-upload.ts';
import { moveUpload } from '../../../src/uploads/uploads/move-upload.ts';
import { pruneUploads } from '../../../src/uploads/uploads/prune-uploads.ts';
import { putUpload } from '../../../src/uploads/uploads/put-upload.ts';
import { sweepUploadSessions } from '../../../src/uploads/uploads/sweep-upload-sessions.ts';
import { updateUpload } from '../../../src/uploads/uploads/update-upload.ts';
import { bytes, storage, stream } from '../_fixture.ts';

function put(directory: string, name: string): Promise<UploadRecord> {
  return putUpload({ directory, name, body: stream(bytes(name)) });
}

function within(prefix: string, paths: readonly string[]): string[] {
  return paths.filter((path) => path.startsWith(`${prefix}/`));
}

/**
 * Opens an upload session for `name` under `sweep` that expired long ago, resolving its `UUID`.
 * Opening one sweeps the sessions already expired, so a test opens its live sessions first.
 */
async function expiredSession(name: string): Promise<string> {
  const { UUID } = await createUploadSession({ directory: 'sweep', name, size: 6 });
  await queryUntyped('UploadsSessions')
    .unscoped()
    .where({ UUID })
    .updateOrThrow({ expiresAt: 1_000 });
  return UUID;
}

/**
 * The `UUID` of every upload session row.
 */
function sessionUUIDs(): Promise<unknown[]> {
  return queryUntyped('UploadsSessions').unscoped().pluck('UUID');
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

  it('skips a path a pending move still touches', async () => {
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

  it('keeps listing a stray whose delete is still pending, journaled once', async (t) => {
    storage.objects.set('stuck/stray.txt', bytes('stray'));
    const { delete: remove } = storage;
    const failing = t.mock.method(storage, 'delete', async (path: string) => {
      if (path === 'stuck/stray.txt') throw new Error('read-only');
      await remove(path);
    });

    deepStrictEqual(within('stuck', await pruneUploads({ delete: true })), ['stuck/stray.txt']);
    deepStrictEqual(within('stuck', await pruneUploads({ delete: true })), ['stuck/stray.txt']);
    deepStrictEqual(within('stuck', await pruneUploads()), ['stuck/stray.txt']);
    strictEqual(await queryUntyped('UploadsJournal').where({ from: 'stuck/stray.txt' }).count(), 1);
    failing.mock.restore();
    strictEqual(await drainJournal(), true);
    strictEqual(storage.objects.has('stuck/stray.txt'), false);
  });

  it('lists a deleted file whose delete waits behind a failing lock', async () => {
    const { UUID } = await put('locked', 'gone.txt');
    const { setPrivate } = storage;
    storage.setPrivate = async () => {
      throw new Error('acl');
    };
    try {
      await updateUpload(UUID, { private: true });
      await deleteUpload(UUID);

      deepStrictEqual(within('locked', await pruneUploads({ delete: true })), ['locked/gone.txt']);
      strictEqual(
        await queryUntyped('UploadsJournal')
          .where({ op: 'delete', from: 'locked/gone.txt' })
          .count(),
        1,
      );
    } finally {
      storage.setPrivate = setPrivate;
    }
    strictEqual(await drainJournal(), true);
    strictEqual(storage.objects.has('locked/gone.txt'), false);
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

  it('leaves the expired upload sessions to `sweepUploadSessions`', async () => {
    const expired = await expiredSession('thrall.txt');

    await pruneUploads();

    deepStrictEqual(await sessionUUIDs(), [expired]);
    strictEqual(await sweepUploadSessions(2_000), 1);
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
