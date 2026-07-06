import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import { useEnv } from 'ohne';

import { connect } from '../../../src/ohne/database/connect.ts';
import { closeDatabases } from '../../../src/ohne/database/use-database.ts';
import { withLock } from '../../../src/ohne/database/with-lock.ts';
import { sleep } from '../../../src/utils/index.ts';

describe('withLock', () => {
  afterEach(async () => {
    await closeDatabases();
    useEnv().unset('DATABASE');
  });

  async function open(): Promise<void> {
    useEnv().set('DATABASE', ':memory:');
    await connect();
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
});
