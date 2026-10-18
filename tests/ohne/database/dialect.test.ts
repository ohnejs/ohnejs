import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { sleep } from '../../../src/utils/index.ts';
import { connectTest, dialect } from '../../_dialect.ts';

const nullObj = <T extends object>(o: T): T => Object.assign(Object.create(null), o);

describe('Dialect', () => {
  describe('schemaTransaction', () => {
    it('commits DDL and DML together and returns the result', async () => {
      const db = await connectTest();
      const result = await dialect.schemaTransaction(db, async (tx) => {
        await tx.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');
        await tx.run('INSERT INTO t (id) VALUES (?)', ['a']);
        return 'done';
      });
      strictEqual(result, 'done');
      deepStrictEqual(await db.query('SELECT id FROM t'), [nullObj({ id: 'a' })]);
      await db.close();
    });

    it('rolls back on success but returns the result when commit is false', async () => {
      const db = await connectTest();
      const result = await dialect.schemaTransaction(
        db,
        async (tx) => {
          await tx.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');
          await tx.run('INSERT INTO t (id) VALUES (?)', ['a']);
          return 'done';
        },
        { commit: false },
      );
      strictEqual(result, 'done');
      deepStrictEqual(await dialect.listTables(db), []);
      await db.close();
    });

    it('rolls back DDL atomically when fn throws, then rethrows', async () => {
      const db = await connectTest();
      await rejects(
        dialect.schemaTransaction(db, async (tx) => {
          await tx.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');
          throw new Error('boom');
        }),
        /boom/,
      );
      deepStrictEqual(await dialect.listTables(db), []);
      await db.close();
    });
  });

  describe('cluster lock', () => {
    it('grants the lock to one caller and refuses the next', async () => {
      const db = await connectTest();
      const first = await dialect.acquireLock(db, 'sync');
      ok(first);
      strictEqual(await dialect.acquireLock(db, 'sync'), null);
      await db.close();
    });

    it('frees the lock on release, so it can be re-acquired', async () => {
      const db = await connectTest();
      const handle = await dialect.acquireLock(db, 'sync');
      ok(handle);
      await dialect.releaseLock(db, handle);
      ok(await dialect.acquireLock(db, 'sync'));
      await db.close();
    });

    it('ignores a release with a mismatched nonce', async () => {
      const db = await connectTest();
      ok(await dialect.acquireLock(db, 'sync'));
      await dialect.releaseLock(db, { key: 'sync', nonce: 'wrong' });
      strictEqual(await dialect.acquireLock(db, 'sync'), null);
      await db.close();
    });

    it('waitForLock resolves once the holder releases', async () => {
      const db = await connectTest();
      const handle = await dialect.acquireLock(db, 'sync');
      ok(handle);
      let settled = false;
      const waited = dialect
        .waitForLock(db, 'sync', { pollInterval: 5, staleAfter: 10_000 })
        .then(() => (settled = true));
      await sleep(15);
      strictEqual(settled, false);
      await dialect.releaseLock(db, handle);
      await waited;
      ok(await dialect.acquireLock(db, 'sync'));
      await db.close();
    });

    it('waitForLock steals an abandoned lock', async () => {
      const db = await connectTest();
      ok(await dialect.acquireLock(db, 'sync'));
      await db.run('UPDATE "ohne_locks" SET "acquiredAt" = ? WHERE "key" = ?', [
        Date.now() - 10_000,
        'sync',
      ]);
      await dialect.waitForLock(db, 'sync', { pollInterval: 5, staleAfter: 50 });
      ok(await dialect.acquireLock(db, 'sync'));
      await db.close();
    });

    it("renewLock moves the holder's acquiredAt to now and leaves a rival's row alone", async (t) => {
      const db = await connectTest();
      const handle = await dialect.acquireLock(db, 'sync');
      ok(handle);
      const renewed = [nullObj({ acquiredAt: 5_000 })];
      t.mock.timers.enable({ apis: ['Date'], now: 5_000 });
      await dialect.renewLock(db, handle);
      deepStrictEqual(await db.query('SELECT "acquiredAt" FROM "ohne_locks"'), renewed);
      t.mock.timers.tick(1_000);
      await dialect.renewLock(db, { key: 'sync', nonce: 'wrong' });
      deepStrictEqual(await db.query('SELECT "acquiredAt" FROM "ohne_locks"'), renewed);
      await db.close();
    });

    it('releaseAbandonedLock frees an absent or abandoned key and keeps a live one', async () => {
      const db = await connectTest();
      await dialect.waitForLock(db, 'sync', { pollInterval: 5, staleAfter: 50 });
      strictEqual(await dialect.releaseAbandonedLock(db, 'sync', 50), true);
      ok(await dialect.acquireLock(db, 'sync'));
      strictEqual(await dialect.releaseAbandonedLock(db, 'sync', 10_000), false);
      strictEqual(await dialect.acquireLock(db, 'sync'), null);
      await db.run('UPDATE "ohne_locks" SET "acquiredAt" = ?', [Date.now() - 10_000]);
      strictEqual(await dialect.releaseAbandonedLock(db, 'sync', 50), true);
      deepStrictEqual(await db.query('SELECT * FROM "ohne_locks"'), []);
      await db.close();
    });

    it('ensures the lock table once per adapter', async (t) => {
      const db = await connectTest();
      const ensure = t.mock.method(dialect, 'ensureTable');
      const handle = await dialect.acquireLock(db, 'sync');
      ok(handle);
      strictEqual(await dialect.acquireLock(db, 'sync'), null);
      await dialect.releaseLock(db, handle);
      await dialect.waitForLock(db, 'sync', { pollInterval: 5, staleAfter: 50 });
      strictEqual(ensure.mock.callCount(), 1);
      await db.close();
    });
  });
});
