import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';

import { afterCommit, committing } from '../../../src/ohne/database/after-commit.ts';
import { connectTest } from '../../_dialect.ts';

const raw = await connectTest();
const db = committing(raw);
await db.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');

after(() => db.close());

async function ids(): Promise<string[]> {
  return (await db.query<{ id: string }>('SELECT id FROM t')).map((row) => row.id);
}

describe('committing', () => {
  beforeEach(() => db.run('DELETE FROM t'));

  it('runs queued work in order once the transaction commits', async () => {
    const seen: string[] = [];
    await db.transaction(async (tx) => {
      await tx.run('INSERT INTO t (id) VALUES (?)', ['a']);
      ok(afterCommit(tx, async () => void seen.push('first')));
      ok(afterCommit(tx, async () => void seen.push('second')));
      strictEqual(seen.length, 0);
    });
    deepStrictEqual(seen, ['first', 'second']);
  });

  it('runs queued work outside the transaction, so it may open its own', async () => {
    await db.transaction(async (tx) => {
      afterCommit(tx, async () => {
        await db.transaction(
          (own) => own.run('INSERT INTO t (id) VALUES (?)', ['after']),
          'immediate',
        );
      });
    }, 'immediate');
    deepStrictEqual(await ids(), ['after']);
  });

  it('drops queued work when the transaction rolls back', async () => {
    const seen: string[] = [];
    await rejects(
      db.transaction(async (tx) => {
        afterCommit(tx, async () => void seen.push('never'));
        throw new Error('roll back');
      }),
      /roll back/,
    );
    strictEqual(seen.length, 0);
  });

  it('rejects with a failing flush while the rows stay committed', async () => {
    await rejects(
      db.transaction(async (tx) => {
        await tx.run('INSERT INTO t (id) VALUES (?)', ['kept']);
        afterCommit(tx, async () => {
          throw new Error('flush');
        });
      }),
      /flush/,
    );
    deepStrictEqual(await ids(), ['kept']);
  });

  it('refuses to queue on a transaction it did not open', async () => {
    await raw.transaction(async (tx) => {
      strictEqual(
        afterCommit(tx, async () => undefined),
        false,
      );
    });
  });

  it('wraps one adapter once, and a wrapper not at all', () => {
    strictEqual(committing(raw), db);
    strictEqual(committing(db), db);
  });
});
