import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { mapConcurrent, sleep } from '../../../src/utils/index.ts';

describe('mapConcurrent', () => {
  it('keeps the input order whatever order calls settle in', async () => {
    const result = await mapConcurrent([30, 10, 20], 3, async (ms) => {
      await sleep(ms);
      return ms;
    });
    deepStrictEqual(result, [30, 10, 20]);
  });

  it('runs at most limit calls at once', async () => {
    let running = 0;
    let peak = 0;
    await mapConcurrent(
      Array.from({ length: 10 }, (_, i) => i),
      3,
      async () => {
        peak = Math.max(peak, ++running);
        await sleep(2);
        running--;
      },
    );
    strictEqual(peak, 3);
  });

  it('accepts any iterable and resolves [] for none', async () => {
    deepStrictEqual(await mapConcurrent(new Set([1, 2]), 1, async (n) => n * 2), [2, 4]);
    deepStrictEqual(await mapConcurrent([], 4, async (n) => n), []);
  });

  it('starts nothing after a rejection and rejects once in-flight calls settle', async () => {
    const started: number[] = [];
    let settled = 0;
    await rejects(
      mapConcurrent([1, 2, 3, 4, 5], 2, async (n) => {
        started.push(n);
        if (n === 1) throw new Error('first');
        await sleep(10);
        settled++;
      }),
      /first/,
    );
    deepStrictEqual(started, [1, 2]);
    strictEqual(settled, 1);
  });

  it('rejects a limit below 1', async () => {
    await rejects(
      mapConcurrent([1], 0, async (n) => n),
      /Invalid concurrency limit: 0/,
    );
  });
});
