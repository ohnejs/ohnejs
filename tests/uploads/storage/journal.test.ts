import { deepStrictEqual, match, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { withLock } from '../../../src/ohne/database/with-lock.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import { usePrinter } from '../../../src/ohne/printer/use-printer.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import {
  drainJournal,
  journalStorage,
  type JournalEntry,
} from '../../../src/uploads/storage/journal.ts';
import { useStorages } from '../../../src/uploads/storage/use-storages.ts';
import { sleep } from '../../../src/utils/index.ts';
import { bytes, db, storage, text } from '../_fixture.ts';
import { createMemoryStorage } from '../_storage.ts';

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

/**
 * Journals each entry in its own transaction, back to back.
 */
async function journal(...entries: JournalEntry[]): Promise<void> {
  for (const entry of entries) {
    await db.transaction((tx) => journalStorage(tx, entry), 'immediate');
  }
}

async function pending(): Promise<string[]> {
  const rows = await queryUntyped('UploadsJournal').orderBy('sequence').findMany();
  return rows.map((row) => `${row.op} ${row.from}`);
}

describe('journalStorage', () => {
  it('writes the entry with the transaction, a delete carrying no target', async () => {
    await journal({ op: 'move', from: '.tmp/a', to: 'j/a.txt' }, { op: 'delete', from: 'j/b.txt' });
    const rows = await queryUntyped('UploadsJournal').orderBy('sequence').findMany();
    deepStrictEqual(
      rows.map((row) => [row.op, row.from, row.to]),
      [
        ['move', '.tmp/a', 'j/a.txt'],
        ['delete', 'j/b.txt', null],
      ],
    );
    await queryUntyped('UploadsJournal')
      .where({ op: { in: ['move', 'delete'] } })
      .delete();
  });

  it('writes a lock and an unlock, neither carrying a target', async () => {
    await journal({ op: 'lock', from: 'j/vault' }, { op: 'unlock', from: 'j/open.txt' });
    const rows = await queryUntyped('UploadsJournal').orderBy('sequence').findMany();
    deepStrictEqual(
      rows.map((row) => [row.op, row.from, row.to]),
      [
        ['lock', 'j/vault', null],
        ['unlock', 'j/open.txt', null],
      ],
    );
    await queryUntyped('UploadsJournal')
      .where({ op: { in: ['lock', 'unlock'] } })
      .delete();
  });

  it('numbers entries in write order, within a transaction and across them', async () => {
    await db.transaction(async (tx) => {
      await journalStorage(tx, { op: 'move', from: '.tmp/n', to: 'j/n.txt' });
      await journalStorage(tx, { op: 'lock', from: 'j/n.txt' });
    }, 'immediate');
    await journal({ op: 'delete', from: 'j/n.txt' });
    const rows = await queryUntyped('UploadsJournal').orderBy('sequence').findMany();
    deepStrictEqual(
      rows.map((row) => row.op),
      ['move', 'lock', 'delete'],
    );
    const [first, second, third] = rows.map((row) => row.sequence as number);
    deepStrictEqual([second - first, third - second], [1, 1]);
    await queryUntyped('UploadsJournal')
      .where({ from: { in: ['.tmp/n', 'j/n.txt'] } })
      .delete();
  });
});

describe('drainJournal', () => {
  it('runs every entry in order and deletes it once done', async () => {
    storage.objects.set('.tmp/one', bytes('1'));
    storage.objects.set('drain/old.txt', bytes('old'));
    await journal(
      { op: 'move', from: '.tmp/one', to: 'drain/one.txt' },
      { op: 'delete', from: 'drain/old.txt' },
    );
    deepStrictEqual(await pending(), ['move .tmp/one', 'delete drain/old.txt']);

    strictEqual(await drainJournal(), true);
    deepStrictEqual(await pending(), []);
    ok(storage.objects.has('drain/one.txt'));
    strictEqual(storage.objects.has('.tmp/one'), false);
    strictEqual(storage.objects.has('drain/old.txt'), false);
  });

  it('warns about a failed effect and replays it on the next drain', async () => {
    storage.objects.set('.tmp/two', bytes('2'));
    await journal({ op: 'move', from: '.tmp/two', to: 'drain/two.txt' });
    storage.failNext('move');
    written.length = 0;

    strictEqual(await drainJournal(), false);
    deepStrictEqual(await pending(), ['move .tmp/two']);
    strictEqual(storage.objects.has('drain/two.txt'), false);
    match(written.join(''), /Storage move of \.tmp\/two failed/);

    strictEqual(await drainJournal(), true);
    deepStrictEqual(await pending(), []);
    ok(storage.objects.has('drain/two.txt'));
  });

  it('warns instead of throwing when the journal cannot be read', async () => {
    storage.objects.set('.tmp/five', bytes('5'));
    await journal({ op: 'move', from: '.tmp/five', to: 'drain/five.txt' });
    written.length = 0;

    await db.exec('ALTER TABLE "UploadsJournal" RENAME TO "UploadsJournalAside"');
    try {
      strictEqual(await drainJournal(), false);
    } finally {
      await db.exec('ALTER TABLE "UploadsJournalAside" RENAME TO "UploadsJournal"');
    }
    match(written.join(''), /Storage journal not drained/);
    deepStrictEqual(await pending(), ['move .tmp/five']);

    await drainJournal();
    deepStrictEqual(await pending(), []);
    ok(storage.objects.has('drain/five.txt'));
  });

  it('serializes overlapping drains', async () => {
    storage.objects.set('.tmp/three', bytes('3'));
    storage.objects.set('.tmp/four', bytes('4'));
    await journal(
      { op: 'move', from: '.tmp/three', to: 'drain/three.txt' },
      { op: 'move', from: '.tmp/four', to: 'drain/four.txt' },
    );
    await Promise.all([drainJournal(), drainJournal()]);
    deepStrictEqual(await pending(), []);
    ok(storage.objects.has('drain/three.txt'));
    ok(storage.objects.has('drain/four.txt'));
  });

  it('locks a prefix with everything under it, and unlocks one object', async () => {
    storage.objects.set('drain/vault/a.txt', bytes('a'));
    storage.objects.set('drain/vault/b.txt', bytes('b'));
    await journal({ op: 'lock', from: 'drain/vault' }, { op: 'unlock', from: 'drain/vault/b.txt' });
    await drainJournal();
    deepStrictEqual(await pending(), []);
    strictEqual(storage.visibility.get('drain/vault/a.txt'), true);
    strictEqual(storage.visibility.get('drain/vault/b.txt'), false);
  });

  it('warns about a failed lock and replays it on the next drain', async () => {
    storage.objects.set('drain/late.txt', bytes('l'));
    await journal({ op: 'lock', from: 'drain/late.txt' });
    storage.failNext('setPrivate');
    written.length = 0;

    await drainJournal();
    deepStrictEqual(await pending(), ['lock drain/late.txt']);
    strictEqual(storage.visibility.has('drain/late.txt'), false);
    match(written.join(''), /Storage lock of drain\/late\.txt failed/);

    await drainJournal();
    deepStrictEqual(await pending(), []);
    strictEqual(storage.visibility.get('drain/late.txt'), true);
  });

  it('carries a lock journaled before its move to where the object lands', async () => {
    storage.objects.set('.tmp/six', bytes('6'));
    await db.transaction(async (tx) => {
      await journalStorage(tx, { op: 'lock', from: '.tmp/six' });
      await journalStorage(tx, { op: 'move', from: '.tmp/six', to: 'drain/same/six.txt' });
    }, 'immediate');
    await drainJournal();
    deepStrictEqual(await pending(), []);
    strictEqual(storage.visibility.get('drain/same/six.txt'), true);
    strictEqual(storage.visibility.has('.tmp/six'), false);
  });

  it('holds the move while the lock before it fails', async () => {
    storage.objects.set('.tmp/nine', bytes('9'));
    await db.transaction(async (tx) => {
      await journalStorage(tx, { op: 'lock', from: '.tmp/nine' });
      await journalStorage(tx, { op: 'move', from: '.tmp/nine', to: 'drain/nine.txt' });
    }, 'immediate');
    storage.failNext('setPrivate');

    strictEqual(await drainJournal(), false);
    deepStrictEqual(await pending(), ['lock .tmp/nine', 'move .tmp/nine']);
    strictEqual(storage.objects.has('drain/nine.txt'), false);

    strictEqual(await drainJournal(), true);
    strictEqual(storage.visibility.get('drain/nine.txt'), true);
  });

  it('holds back every later entry on a path whose effect failed', async () => {
    storage.objects.set('.tmp/seven', bytes('7'));
    storage.objects.set('.tmp/eight', bytes('8'));
    await db.transaction(async (tx) => {
      await journalStorage(tx, { op: 'move', from: '.tmp/seven', to: 'drain/held/seven.pdf' });
      await journalStorage(tx, { op: 'lock', from: 'drain/held/seven.pdf' });
    }, 'immediate');
    await journal(
      { op: 'lock', from: 'drain/held' },
      { op: 'move', from: '.tmp/eight', to: 'drain/free.txt' },
    );
    storage.failNext('move');

    await drainJournal();
    deepStrictEqual(await pending(), [
      'move .tmp/seven',
      'lock drain/held/seven.pdf',
      'lock drain/held',
    ]);
    strictEqual(storage.visibility.has('drain/held/seven.pdf'), false);
    ok(storage.objects.has('drain/free.txt'));

    await drainJournal();
    deepStrictEqual(await pending(), []);
    ok(storage.objects.has('drain/held/seven.pdf'));
    strictEqual(storage.visibility.get('drain/held/seven.pdf'), true);
  });

  it('runs entries of separate transactions in the order they were written', async () => {
    const names = Array.from({ length: 20 }, (_, i) => `drain/reuse/${i}.txt`);
    for (const [i, name] of names.entries()) {
      storage.objects.set(name, bytes('old'));
      storage.objects.set(`.tmp/reuse-${i}`, bytes('new'));
    }
    for (const [i, name] of names.entries()) {
      await journal(
        { op: 'delete', from: name },
        { op: 'move', from: `.tmp/reuse-${i}`, to: name },
      );
    }
    await drainJournal();
    deepStrictEqual(await pending(), []);
    deepStrictEqual(
      names.map((name) => text(storage.objects.get(name))),
      names.map(() => 'new'),
    );
  });

  it('runs an entry from before entries were numbered first', async () => {
    storage.objects.set('.tmp/legacy', bytes('l'));
    await queryUntyped('UploadsJournal').createOrThrow({
      sequence: null,
      op: 'move',
      from: '.tmp/legacy',
      to: 'drain/legacy.txt',
    });
    await journal({ op: 'lock', from: 'drain/legacy.txt' });
    const [, lock] = await queryUntyped('UploadsJournal').orderBy('sequence').findMany();
    strictEqual(lock.sequence, 1);
    await drainJournal();
    deepStrictEqual(await pending(), []);
    strictEqual(storage.visibility.get('drain/legacy.txt'), true);
  });

  it('counts a lock as done on a backend without setPrivate', async () => {
    useStorages().register('plain', () => ({ ...createMemoryStorage(), setPrivate: undefined }));
    useLayers().add({ path: '/journal-plain', input: { uploads: { storage: 'plain' } } });
    try {
      await journal(
        { op: 'lock', from: 'drain/plain.txt' },
        { op: 'unlock', from: 'drain/plain.txt' },
      );
      await drainJournal();
      deepStrictEqual(await pending(), []);
    } finally {
      useLayers().remove('/journal-plain');
    }
  });

  it('waits while another instance holds the drain, so no entry replays twice at once', async () => {
    storage.objects.set('drain/held.txt', bytes('h'));
    await journal({ op: 'lock', from: 'drain/held.txt' });
    let release = (): void => undefined;
    const other = withLock('uploads:journal', () => new Promise<void>((done) => (release = done)));

    const drained = drainJournal();
    await sleep(50);
    deepStrictEqual(await pending(), ['lock drain/held.txt']);

    release();
    await other;
    strictEqual(await drained, true);
    deepStrictEqual(await pending(), []);
  });
});
