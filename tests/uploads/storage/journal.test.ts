import { deepStrictEqual, match, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { usePrinter } from '../../../src/ohne/printer/use-printer.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import {
  drainJournal,
  journalStorage,
  type JournalEntry,
} from '../../../src/uploads/storage/journal.ts';
import { sleep } from '../../../src/utils/sleep/sleep.ts';
import { bytes, db, storage } from '../_fixture.ts';

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
 * Journals each entry in its own transaction, a millisecond apart, so their `UUID`s order as written.
 */
async function journal(...entries: JournalEntry[]): Promise<void> {
  for (const entry of entries) {
    await sleep(2);
    await db.transaction((tx) => journalStorage(tx, entry), 'immediate');
  }
}

async function pending(): Promise<string[]> {
  const rows = await queryUntyped('UploadsJournal').orderBy('UUID').findMany();
  return rows.map((row) => `${row.op} ${row.from}`);
}

describe('journalStorage', () => {
  it('writes the entry with the transaction, a delete carrying no target', async () => {
    await journal({ op: 'move', from: '.tmp/a', to: 'j/a.txt' }, { op: 'delete', from: 'j/b.txt' });
    const rows = await queryUntyped('UploadsJournal').orderBy('UUID').findMany();
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

    await drainJournal();
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

    await drainJournal();
    deepStrictEqual(await pending(), ['move .tmp/two']);
    strictEqual(storage.objects.has('drain/two.txt'), false);
    match(written.join(''), /Storage move of \.tmp\/two failed/);

    await drainJournal();
    deepStrictEqual(await pending(), []);
    ok(storage.objects.has('drain/two.txt'));
  });

  it('warns instead of throwing when the journal cannot be read', async () => {
    storage.objects.set('.tmp/five', bytes('5'));
    await journal({ op: 'move', from: '.tmp/five', to: 'drain/five.txt' });
    written.length = 0;

    await db.exec('ALTER TABLE "UploadsJournal" RENAME TO "UploadsJournalAside"');
    try {
      await drainJournal();
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
});
