import { deepStrictEqual, strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { dequeue, enqueue, flush, nextTick } from '../../../src/utils/reactive/_scheduler.ts';

describe('scheduler', () => {
  it('dedupes a job by reference and runs it once per flush', () => {
    let runs = 0;
    const job = () => runs++;
    enqueue(job);
    enqueue(job);
    flush();
    strictEqual(runs, 1);
  });

  it('runs a job enqueued during the flush in the same flush', () => {
    const order: string[] = [];
    const b = () => order.push('b');
    const a = () => {
      order.push('a');
      enqueue(b);
    };
    enqueue(a);
    flush();
    deepStrictEqual(order, ['a', 'b']);
  });

  it('cancels a dequeued job before it runs', () => {
    let runs = 0;
    const job = () => runs++;
    enqueue(job);
    dequeue(job);
    flush();
    strictEqual(runs, 0);
  });

  it('resolves nextTick after the queued jobs run', async () => {
    let ran = false;
    enqueue(() => (ran = true));
    await nextTick();
    strictEqual(ran, true);
  });

  it('runs every job, rethrows the first error, and stays usable', () => {
    const ran: number[] = [];
    enqueue(() => {
      ran.push(1);
      throw new Error('boom');
    });
    enqueue(() => ran.push(2));
    throws(() => flush(), /boom/);
    deepStrictEqual(ran, [1, 2]);

    let after = 0;
    enqueue(() => after++);
    flush();
    strictEqual(after, 1);
  });
});
