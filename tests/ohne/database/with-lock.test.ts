import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { useEnv } from 'ohnejs';

import type { WithLockOptions } from '../../../src/ohne/database/with-lock.ts';

import { connect } from '../../../src/ohne/database/connect.ts';
import { closeDatabases, useDatabase } from '../../../src/ohne/database/use-database.ts';
import { withLock } from '../../../src/ohne/database/with-lock.ts';
import { sleep } from '../../../src/utils/index.ts';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

describe('withLock', () => {
  afterEach(async () => {
    await closeDatabases();
    useEnv().unset('DATABASE');
  });

  async function open(): Promise<void> {
    useEnv().set('DATABASE', ':memory:');
    await connect();
  }

  /**
   * Leaves a lock on `key` whose holder crashed past the takeover window.
   */
  async function abandon(key: string): Promise<void> {
    await withLock('warm', () => undefined);
    await useDatabase().run(
      'INSERT INTO "ohne_locks" ("key", "nonce", "acquiredAt") VALUES (?, ?, ?)',
      [key, 'crashed', Date.now() - 21_000],
    );
  }

  /**
   * Holds `key` from a sibling call chain, resolving the function that releases it.
   */
  async function hold(key: string): Promise<() => Promise<void>> {
    const gate = Promise.withResolvers<void>();
    const entered = Promise.withResolvers<void>();
    const held = withLock(key, () => {
      entered.resolve();
      return gate.promise;
    });
    await entered.promise;
    return () => {
      gate.resolve();
      return held;
    };
  }

  /**
   * The last time the lock on `key` was taken or renewed.
   */
  async function acquiredAt(key: string): Promise<number | undefined> {
    const row = await useDatabase().queryOne<{ acquiredAt: number }>(
      'SELECT "acquiredAt" FROM "ohne_locks" WHERE "key" = ?',
      [key],
    );
    return row?.acquiredAt;
  }

  it('runs fn under the lock and returns its value', async () => {
    await open();
    strictEqual(await withLock('job', () => 42), 42);
    strictEqual(await withLock('job', () => 'again'), 'again');
  });

  it('releases the lock when fn throws, and rethrows', async () => {
    await open();
    await rejects(
      withLock('job', () => {
        throw new Error('boom');
      }),
      /boom/,
    );
    strictEqual(await withLock('job', () => 'free'), 'free');
  });

  it('serializes concurrent holders of one key', async () => {
    await open();
    const order: string[] = [];
    const job = (id: string) =>
      withLock(
        'job',
        async () => {
          order.push(`${id}:in`);
          await sleep(20);
          order.push(`${id}:out`);
        },
        { pollInterval: 5 },
      );
    await Promise.all([job('a'), job('b')]);
    deepStrictEqual(
      order.map((mark) => mark.split(':')[1]),
      ['in', 'out', 'in', 'out'],
    );
  });

  it('lets distinct keys run concurrently', async () => {
    await open();
    const order: string[] = [];
    const job = (key: string) =>
      withLock(
        key,
        async () => {
          order.push(`${key}:in`);
          await sleep(20);
          order.push(`${key}:out`);
        },
        { pollInterval: 5 },
      );
    await Promise.all([job('one'), job('two')]);
    deepStrictEqual(order.slice(0, 2), ['one:in', 'two:in']);
  });

  it('rejects the reserved sync key', async () => {
    await open();
    await rejects(
      withLock('sync', () => undefined),
      /reserved for the schema sync/,
    );
  });

  it('throws before the database is connected', async () => {
    await rejects(
      withLock('job', () => undefined),
      /not connected/,
    );
  });

  it('takes over a lock whose holder stopped renewing it', async () => {
    await open();
    await abandon('job');
    strictEqual(await withLock('job', () => 'ran', { pollInterval: 5 }), 'ran');
  });

  it('renews the lock while fn runs, so no bid takes it over', async (t) => {
    await open();
    t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_000_000 });
    const release = await hold('job');
    for (let beat = 0; beat < 5; beat++) {
      t.mock.timers.tick(5_000);
      await setImmediate();
    }
    strictEqual(await acquiredAt('job'), 1_025_000);
    strictEqual(await withLock('job', () => 'stolen', { wait: false }), undefined);
    await release();
  });

  it('skips a held lock with `wait: false`, without running fn', async () => {
    await open();
    const release = await hold('job');
    let ran = false;
    const skipped = await withLock(
      'job',
      () => {
        ran = true;
      },
      { wait: false },
    );
    strictEqual(skipped, undefined);
    strictEqual(ran, false);
    await release();
  });

  it('takes any `WithLockOptions`, resolving `T | undefined` when `wait` is not known', async () => {
    await open();
    const options: WithLockOptions = { wait: false };
    const result = withLock('job', () => 'ran', options);
    const typed: Equal<typeof result, Promise<string | undefined>> = true;
    strictEqual(typed, true);
    strictEqual(await result, 'ran');
  });

  it('takes over an abandoned lock with `wait: false`', async () => {
    await open();
    await abandon('job');
    strictEqual(await withLock('job', () => 'ran', { wait: false }), 'ran');
  });

  it('throws on a nested call on a key its call chain holds', async () => {
    await open();
    await rejects(
      withLock('job', () => withLock('job', () => 1)),
      /not reentrant/,
    );
    strictEqual(await withLock('job', () => 'free'), 'free');
  });

  it('nests distinct keys', async () => {
    await open();
    strictEqual(await withLock('outer', () => withLock('inner', () => 1)), 1);
  });

  it('lets work started under the lock take it once released', async () => {
    await open();
    const started = await withLock('job', () => ({
      later: sleep(10).then(() => withLock('job', () => 'after')),
    }));
    strictEqual(await started.later, 'after');
  });
});
