import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import '../../../src/uploads/boot/journal.ts';
import { ohneError } from '../../../src/ohne/error/ohne-error.ts';
import { applyHook } from '../../../src/ohne/hooks/apply-hook.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import { usePrinter } from '../../../src/ohne/printer/use-printer.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { drainJournal, journalStorage } from '../../../src/uploads/storage/journal.ts';
import { useStorages } from '../../../src/uploads/storage/use-storages.ts';
import { sessionTemp } from '../../../src/uploads/uploads/_session.ts';
import { abortUploadSession } from '../../../src/uploads/uploads/abort-upload-session.ts';
import { createUploadSession } from '../../../src/uploads/uploads/create-upload-session.ts';
import { TEMP_PREFIX } from '../../../src/uploads/uploads/path.ts';
import { uuidv7 } from '../../../src/utils/uuid/uuidv7.ts';
import { bytes, db, holdSession, promptly, storage, text } from '../_fixture.ts';

const written: string[] = [];
usePrinter().configure({
  stream: {
    write: (chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    },
  },
  color: false,
});

const DAY = 24 * 60 * 60 * 1000;

function uuidAt(ms: number): string {
  const hex = ms.toString(16).padStart(12, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8)}${uuidv7().slice(13)}`;
}

const synced = () => applyHook('schema:synced', { deletions: [], warnings: [] });

describe('the schema:synced hook', () => {
  it('drains the pending journal, then sweeps only the stale staged objects', async () => {
    const stale = `${TEMP_PREFIX}/${uuidAt(Date.now() - 2 * DAY)}`;
    const live = `${TEMP_PREFIX}/${uuidv7()}`;
    for (const temp of [stale, live]) {
      storage.objects.set(temp, bytes('staged'));
      await queryUntyped('UploadsJournal').createOrThrow({ op: 'stage', from: temp });
    }
    storage.objects.set(`${TEMP_PREFIX}/staged`, bytes('staged'));
    storage.objects.set('photos/keep.jpg', bytes('keep'));
    await db.transaction(
      (tx) =>
        journalStorage(tx, { op: 'move', from: `${TEMP_PREFIX}/staged`, to: 'photos/staged.jpg' }),
      'immediate',
    );

    await synced();

    deepStrictEqual(await queryUntyped('UploadsJournal').pluck('from'), [live]);
    deepStrictEqual(
      [...storage.objects.keys()].sort(),
      [live, 'photos/keep.jpg', 'photos/staged.jpg'].sort(),
    );
    strictEqual(text(storage.objects.get('photos/staged.jpg')), 'staged');
    await queryUntyped('UploadsJournal').where({ from: live }).delete();
    storage.objects.delete(live);
  });

  it('keeps staged objects while an entry is held', async () => {
    storage.objects.set(`${TEMP_PREFIX}/held`, bytes('held'));
    await db.transaction(async (tx) => {
      await journalStorage(tx, { op: 'lock', from: `${TEMP_PREFIX}/held` });
      await journalStorage(tx, { op: 'move', from: `${TEMP_PREFIX}/held`, to: 'photos/held.jpg' });
    }, 'immediate');
    storage.failNext('setPrivate');

    await synced();

    ok(storage.objects.has(`${TEMP_PREFIX}/held`));
    strictEqual(storage.objects.has('photos/held.jpg'), false);

    await synced();
    strictEqual(storage.objects.has(`${TEMP_PREFIX}/held`), false);
    strictEqual(storage.visibility.get('photos/held.jpg'), true);
  });

  it('throws a storage that cannot be built once, warning nothing', async () => {
    useStorages().register('broken', () => {
      throw ohneError({ title: 'Storage `broken` cannot be built', body: ['Fix its location.'] });
    });
    useLayers().add({ path: '/journal-broken', input: { uploads: { storage: 'broken' } } });
    written.length = 0;
    try {
      await rejects(synced(), /Storage `broken` cannot be built/);
    } finally {
      useLayers().remove('/journal-broken');
    }
    deepStrictEqual(written, []);
    strictEqual(await drainJournal(), true);
  });

  it('checks the storage before the first effect it replays', async () => {
    const order: string[] = [];
    useStorages().register('checked', () => ({
      ...storage,
      check: async () => void order.push('check'),
      delete: async (path) => {
        order.push('delete');
        await storage.delete(path);
      },
    }));
    useLayers().add({ path: '/journal-checked', input: { uploads: { storage: 'checked' } } });
    await db.transaction(
      (tx) => journalStorage(tx, { op: 'delete', from: 'photos/checked.jpg' }),
      'immediate',
    );
    try {
      await synced();
    } finally {
      useLayers().remove('/journal-checked');
    }
    deepStrictEqual(order, ['check', 'delete']);
  });

  it('throws a failed check once, replaying and sweeping nothing', async () => {
    useStorages().register('unreachable', () => ({
      ...storage,
      check: () => Promise.reject(ohneError({ title: 'Storage `unreachable` did not answer' })),
    }));
    useLayers().add({
      path: '/journal-unreachable',
      input: { uploads: { storage: 'unreachable' } },
    });
    const stale = `${TEMP_PREFIX}/${uuidAt(Date.now() - 2 * DAY)}`;
    storage.objects.set(stale, bytes('staged'));
    await queryUntyped('UploadsJournal').createOrThrow({ op: 'stage', from: stale });
    await db.transaction(
      (tx) => journalStorage(tx, { op: 'delete', from: 'photos/pending.jpg' }),
      'immediate',
    );
    written.length = 0;
    try {
      await rejects(synced(), /Storage `unreachable` did not answer/);
    } finally {
      useLayers().remove('/journal-unreachable');
    }
    deepStrictEqual(written, []);
    deepStrictEqual((await queryUntyped('UploadsJournal').pluck('op')).sort(), ['delete', 'stage']);
    ok(storage.objects.has(stale));
    strictEqual(await drainJournal(), true);
    await queryUntyped('UploadsJournal').where({ from: stale }).delete();
    storage.objects.delete(stale);
  });

  it('sweeps the expired upload sessions after the stale staged objects', async () => {
    const order: string[] = [];
    const parts = storage.parts!;
    useStorages().register('sweeping', () => ({
      ...storage,
      delete: async (path) => {
        order.push(`delete ${path}`);
        await storage.delete(path);
      },
      parts: {
        ...parts,
        abort: async (path, handle) => {
          order.push(`abort ${path}`);
          await parts.abort(path, handle);
        },
      },
    }));
    useLayers().add({ path: '/journal-sweeping', input: { uploads: { storage: 'sweeping' } } });
    const stale = `${TEMP_PREFIX}/${uuidAt(Date.now() - 2 * DAY)}`;
    storage.objects.set(stale, bytes('staged'));
    await queryUntyped('UploadsJournal').createOrThrow({ op: 'stage', from: stale });
    const expired = await createUploadSession({ name: 'frostmourne.txt', size: 6 });
    const live = await createUploadSession({ name: 'ashbringer.txt', size: 6 });
    await queryUntyped('UploadsSessions')
      .unscoped()
      .where({ UUID: expired.UUID })
      .updateOrThrow({ expiresAt: 1_000 });
    try {
      await synced();
    } finally {
      useLayers().remove('/journal-sweeping');
    }
    const temp = sessionTemp(expired.UUID);
    deepStrictEqual(order, [`delete ${stale}`, `abort ${temp}`, `delete ${temp}`]);
    deepStrictEqual(await queryUntyped('UploadsSessions').unscoped().pluck('UUID'), [live.UUID]);
    await abortUploadSession(live.UUID);
  });

  it('boots past an expired session whose lock a live holder keeps', async () => {
    const held = await createUploadSession({ name: 'gorehowl.txt', size: 6 });
    await queryUntyped('UploadsSessions')
      .unscoped()
      .where({ UUID: held.UUID })
      .updateOrThrow({ expiresAt: 1_000 });
    const release = await holdSession(held.UUID);
    try {
      strictEqual(await promptly(synced().then(() => 'booted')), 'booted');
      ok(await queryUntyped('UploadsSessions').unscoped().where({ UUID: held.UUID }).exists());
    } finally {
      await release();
    }
    await abortUploadSession(held.UUID);
  });
});
