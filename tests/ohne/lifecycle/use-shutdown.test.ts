import { deepStrictEqual, strictEqual } from 'node:assert';
import { before, beforeEach, describe, it } from 'node:test';

import { useShutdown, usePrinter } from '../../../src/ohne/index.ts';
import { sleep } from '../../../src/utils/index.ts';

before(() => {
  usePrinter().configure({ stream: { write() {} } });
});

describe('useShutdown', () => {
  beforeEach(() => {
    useShutdown().clear();
  });

  it('runs hooks in registration order, awaiting each', async () => {
    const order: number[] = [];
    useShutdown().add(async () => {
      await sleep(10);
      order.push(1);
    });
    useShutdown().add(() => {
      order.push(2);
    });

    const { completed } = await useShutdown().run();
    strictEqual(completed, true);
    deepStrictEqual(order, [1, 2]);
  });

  it('logs a throwing hook and continues with the rest', async () => {
    const order: number[] = [];
    useShutdown().add(() => {
      throw new Error('boom');
    });
    useShutdown().add(() => {
      order.push(2);
    });

    const { completed } = await useShutdown().run();
    strictEqual(completed, true);
    deepStrictEqual(order, [2]);
  });

  it('returns completed false when the deadline wins', async () => {
    useShutdown().add(() => new Promise<void>(() => {}));
    const { completed } = await useShutdown().run({ deadline: '20ms' });
    strictEqual(completed, false);
  });

  it('is idempotent: a second run returns the first run promise', async () => {
    let count = 0;
    useShutdown().add(() => {
      count++;
    });

    const first = useShutdown().run();
    const second = useShutdown().run();
    strictEqual(first, second);

    await first;
    strictEqual(count, 1);
  });

  it('tracks state across a run', async () => {
    strictEqual(useShutdown().state, 'idle');

    let resolveHook!: () => void;
    useShutdown().add(() => new Promise<void>((resolve) => (resolveHook = resolve)));

    const run = useShutdown().run();
    strictEqual(useShutdown().state, 'running');

    resolveHook();
    await run;
    strictEqual(useShutdown().state, 'done');
  });
});
