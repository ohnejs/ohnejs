import { match, notStrictEqual, ok, strictEqual } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import type { DatabaseAdapter } from '../../../../src/ohne/database/adapter.ts';
import type { LockHandle } from '../../../../src/ohne/database/dialect.ts';
import type { SchemaClassification } from '../../../../src/ohne/database/schema/snapshot.ts';

import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { acquireSyncLock } from '../../../../src/ohne/database/schema/lock.ts';
import { writeSnapshot } from '../../../../src/ohne/database/schema/snapshot.ts';
import { sleep } from '../../../../src/utils/index.ts';

const dialect = new SQLiteDialect();

const root = mkdtempSync(join(tmpdir(), 'ohne-lock-'));
let sequence = 0;

after(() => rmSync(root, { recursive: true, force: true }));

async function openPair(): Promise<[DatabaseAdapter, DatabaseAdapter]> {
  const path = join(root, `db-${sequence++}.db`);
  return [await dialect.connect(path), await dialect.connect(path)];
}

async function snapshotOf(db: DatabaseAdapter, generation: number, hash: string): Promise<void> {
  const classification: SchemaClassification = {};
  await writeSnapshot(db, dialect, { generation, hash, classification });
}

describe('acquireSyncLock', () => {
  it('wins on a silent database', async () => {
    const [a, b] = await openPair();
    const handle = await acquireSyncLock(a, dialect, { desiredHash: 'H' });
    ok(handle);
    match(handle.nonce, /./);
    await a.close();
    await b.close();
  });

  it('boots a loser without syncing once the winner realized the same hash', async () => {
    const [a, b] = await openPair();
    const handle = await acquireSyncLock(a, dialect, { desiredHash: 'H' });
    ok(handle);
    const pending = acquireSyncLock(b, dialect, { desiredHash: 'H', pollInterval: 5 });
    await sleep(20);
    await snapshotOf(a, 1, 'H');
    await dialect.releaseLock(a, handle);
    strictEqual(await pending, undefined);
    await a.close();
    await b.close();
  });

  it('re-races and wins when the winner released without a snapshot', async () => {
    const [a, b] = await openPair();
    const handle = await acquireSyncLock(a, dialect, { desiredHash: 'H' });
    ok(handle);
    const pending = acquireSyncLock(b, dialect, { desiredHash: 'H', pollInterval: 5 });
    await sleep(20);
    await dialect.releaseLock(a, handle);
    ok(await pending);
    await a.close();
    await b.close();
  });

  it('re-races and wins when its schema is unknown to the database', async () => {
    const [a, b] = await openPair();
    const handle = await acquireSyncLock(a, dialect, { desiredHash: 'H1' });
    ok(handle);
    const pending = acquireSyncLock(b, dialect, { desiredHash: 'H2', pollInterval: 5 });
    await sleep(20);
    await snapshotOf(a, 1, 'H1');
    await dialect.releaseLock(a, handle);
    ok(await pending);
    await a.close();
    await b.close();
  });

  it('re-races and wins when the database holds a different shape', async () => {
    const [a, b] = await openPair();
    const handle = await acquireSyncLock(a, dialect, { desiredHash: 'H2' });
    ok(handle);
    const pending = acquireSyncLock(b, dialect, { desiredHash: 'H1', pollInterval: 5 });
    await sleep(20);
    await snapshotOf(a, 2, 'H2');
    await dialect.releaseLock(a, handle);
    ok(await pending);
    await a.close();
    await b.close();
  });

  it('steals a stale lock and wins', async () => {
    const [a, b] = await openPair();
    const bootstrap = await dialect.acquireLock(a, 'sync');
    ok(bootstrap);
    await dialect.releaseLock(a, bootstrap);
    await a.run('INSERT INTO "ohne_locks" ("key", "nonce", "acquiredAt") VALUES (?, ?, ?)', [
      'sync',
      'dead',
      Date.now() - 10_000,
    ]);
    const handle = await acquireSyncLock(a, dialect, {
      desiredHash: 'H',
      pollInterval: 5,
      staleAfter: 50,
    });
    ok(handle);
    notStrictEqual(handle.nonce, 'dead');
    await a.close();
    await b.close();
  });

  it('treats a busy database during the race as a held lock', async () => {
    const [a, b] = await openPair();
    class BusyOnce extends SQLiteDialect {
      private raced = false;
      override async acquireLock(
        db: DatabaseAdapter,
        key: string,
      ): ReturnType<SQLiteDialect['acquireLock']> {
        if (!this.raced) {
          this.raced = true;
          throw Object.assign(new Error('database is locked'), { errcode: 5 });
        }
        return super.acquireLock(db, key);
      }
    }
    const handle = await acquireSyncLock(a, new BusyOnce(), { desiredHash: 'H', pollInterval: 5 });
    ok(handle);
    await a.close();
    await b.close();
  });

  it('lets exactly one of two concurrent stealers win', async () => {
    const [a, b] = await openPair();
    const bootstrap = await dialect.acquireLock(a, 'sync');
    ok(bootstrap);
    await dialect.releaseLock(a, bootstrap);
    await a.run('INSERT INTO "ohne_locks" ("key", "nonce", "acquiredAt") VALUES (?, ?, ?)', [
      'sync',
      'dead',
      Date.now() - 10_000,
    ]);
    const settle = async (db: DatabaseAdapter): Promise<LockHandle | undefined> => {
      const result = await acquireSyncLock(db, dialect, {
        desiredHash: 'H',
        pollInterval: 5,
        staleAfter: 200,
      });
      if (result) {
        await snapshotOf(db, 1, 'H');
        await dialect.releaseLock(db, result);
      }
      return result;
    };
    const [first, second] = await Promise.all([settle(a), settle(b)]);
    strictEqual([first, second].filter(Boolean).length, 1);
    await a.close();
    await b.close();
  });
});
