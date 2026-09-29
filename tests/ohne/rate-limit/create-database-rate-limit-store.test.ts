import { ok, rejects, strictEqual } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import type { DatabaseAdapter } from '../../../src/ohne/database/adapter.ts';

import { SQLiteDialect } from '../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { registerDatabase, registerDialect } from '../../../src/ohne/database/use-database.ts';
import { isBusyError } from '../../../src/ohne/query/write/busy.ts';
import { createDatabaseRateLimitStore } from '../../../src/ohne/rate-limit/create-database-rate-limit-store.ts';
import { storeContract } from '../../utils/rate-limit/_store-contract.ts';

const dialect = new SQLiteDialect();
registerDialect(dialect);

const root = mkdtempSync(join(tmpdir(), 'ohne-rate-limit-'));
let sequence = 0;

after(() => rmSync(root, { recursive: true, force: true }));

async function helper(adapter?: DatabaseAdapter): Promise<string> {
  const name = `rateLimits${sequence++}`;
  registerDatabase(adapter ?? (await dialect.connect(':memory:')), name);
  return name;
}

const BUSY = Object.assign(new Error('database is locked'), { errcode: 5 });

describe('createDatabaseRateLimitStore', () => {
  storeContract(async () => {
    const clock = { now: 1_800_000_000_000 };
    const database = await helper();
    return { clock, store: createDatabaseRateLimitStore({ database, now: () => clock.now }) };
  });

  it('spends exactly the limit across two connections to one file', async () => {
    const path = join(root, 'shared.db');
    const [a, b] = [await dialect.connect(path), await dialect.connect(path)];
    const stores = [
      createDatabaseRateLimitStore({ database: await helper(a) }),
      createDatabaseRateLimitStore({ database: await helper(b) }),
    ];
    const rate = { limit: 5, window: 60_000 };
    let allowed = 0;
    for (let i = 0; i < 20; i++) if ((await stores[i % 2].take('thrall', rate)) === 0) allowed++;
    strictEqual(allowed, 5);
    await a.close();
    await b.close();
  });

  it('rejects a busy database with the retryable busy error', async () => {
    const busy: DatabaseAdapter = {
      ...(await dialect.connect(':memory:')),
      exec: async () => {
        throw BUSY;
      },
    };
    const store = createDatabaseRateLimitStore({ database: await helper(busy) });
    await rejects(store.take('thrall', { limit: 1, window: 1000 }), isBusyError);
    await rejects(store.reset('thrall'), isBusyError);
  });

  it('decides a hit even when its sweep finds the database busy', async () => {
    const real = await dialect.connect(':memory:');
    const store = createDatabaseRateLimitStore({
      database: await helper({
        ...real,
        run: async () => {
          throw BUSY;
        },
      }),
    });
    strictEqual(await store.take('thrall', { limit: 1, window: 1000 }), 0);
  });

  it('sweeps only rows whose budget is full again', async () => {
    const db = await dialect.connect(':memory:');
    const rate = { limit: 1, window: 1000 };
    await dialect.takeRateLimit(db, 'spent', rate, 0);
    await dialect.takeRateLimit(db, 'live', rate, 500);
    strictEqual(await dialect.sweepRateLimits(db, 1000, 10), 1);
    strictEqual(await dialect.takeRateLimit(db, 'live', rate, 1000), 500);
  });

  it('keeps an overdrawn row until its whole debt has drained', async () => {
    const db = await dialect.connect(':memory:');
    const rate = { limit: 1, window: 1000 };
    strictEqual(await dialect.chargeRateLimit(db, 'thrall', rate, 5, 0), 5000);
    strictEqual(await dialect.sweepRateLimits(db, 2000, 10), 0);
    strictEqual(await dialect.takeRateLimit(db, 'thrall', rate, 2000), 3000);
    strictEqual(await dialect.sweepRateLimits(db, 5000, 10), 1);
  });

  it('rejects a charge on a busy database with the retryable busy error', async () => {
    const busy: DatabaseAdapter = {
      ...(await dialect.connect(':memory:')),
      exec: async () => {
        throw BUSY;
      },
    };
    const store = createDatabaseRateLimitStore({ database: await helper(busy) });
    await rejects(store.charge!('thrall', { limit: 1, window: 1000 }, 1), isBusyError);
  });

  it('sweeps at most one batch at a time', async () => {
    const db = await dialect.connect(':memory:');
    for (let i = 0; i < 5; i++)
      await dialect.takeRateLimit(db, `k${i}`, { limit: 1, window: 1 }, 0);
    strictEqual(await dialect.sweepRateLimits(db, 10, 3), 3);
    strictEqual(await dialect.sweepRateLimits(db, 10, 3), 2);
  });

  it('creates its table on check, and fails for an unknown helper', async () => {
    const db = await dialect.connect(':memory:');
    await createDatabaseRateLimitStore({ database: await helper(db) }).check?.();
    ok(await db.queryOne(`SELECT 1 FROM sqlite_master WHERE name = 'ohne_rate_limits'`));
    await rejects(
      createDatabaseRateLimitStore({ database: 'missing' }).check!(),
      /Unknown database helper/,
    );
  });
});
