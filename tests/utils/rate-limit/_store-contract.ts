import { strictEqual } from 'node:assert';
import { it } from 'node:test';

import type { RateLimitStore } from '../../../src/utils/index.ts';

/**
 * A store under test, read at a clock the test moves.
 */
export interface ClockedStore {
  store: RateLimitStore;
  clock: { now: number };
}

/**
 * Runs the behavior every `RateLimitStore` must share, against stores `make` builds.
 */
export function storeContract(make: () => Promise<ClockedStore>): void {
  const rate = { limit: 2, window: 1000 };

  it('allows a burst, then refills one hit every window / limit', async () => {
    const { store, clock } = await make();
    const start = clock.now;
    const waits: number[] = [];
    for (const at of [0, 0, 0, 100, 499, 500, 501, 1000]) {
      clock.now = start + at;
      waits.push(await store.take('thrall', rate));
    }
    strictEqual(waits.join(), '0,0,500,400,1,0,499,0');
  });

  it('counts nothing for a refused hit', async () => {
    const { store, clock } = await make();
    await store.take('thrall', { limit: 1, window: 1000 });
    for (let i = 0; i < 10; i++) await store.take('thrall', { limit: 1, window: 1000 });
    clock.now += 500;
    strictEqual(await store.take('thrall', { limit: 1, window: 1000 }), 500);
  });

  it('counts keys apart', async () => {
    const { store } = await make();
    await store.take('thrall', { limit: 1, window: 1000 });
    strictEqual(await store.take('jaina', { limit: 1, window: 1000 }), 0);
    strictEqual(await store.take('thrall', { limit: 1, window: 1000 }), 1000);
  });

  it('gives a key its full budget back on reset, whatever its rate', async () => {
    const { store } = await make();
    await store.take('jaina', { limit: 1, window: 1000 });
    await store.take('thrall', { limit: 1, window: 2000 });
    await store.reset('thrall');
    strictEqual(await store.take('thrall', { limit: 1, window: 2000 }), 0);
  });

  it('starts a key over when its rate changes', async () => {
    const { store } = await make();
    await store.take('thrall', { limit: 1, window: 1000 });
    strictEqual(await store.take('thrall', { limit: 1, window: 2000 }), 0);
    strictEqual(await store.take('thrall', { limit: 1, window: 2000 }), 2000);
  });

  it('adds a backward clock step to the wait', async () => {
    const { store, clock } = await make();
    await store.take('thrall', rate);
    await store.take('thrall', rate);
    clock.now -= 1000;
    strictEqual(await store.take('thrall', rate), 1500);
  });

  it('probes the wait with a charge of 0, counting nothing', async () => {
    const { store } = await make();
    strictEqual(await store.charge!('thrall', rate, 0), 0);
    await store.take('thrall', rate);
    await store.take('thrall', rate);
    strictEqual(await store.charge!('thrall', rate, 0), 500);
    strictEqual(await store.charge!('thrall', rate, 0), 500);
    strictEqual(await store.charge!('jaina', rate, 0), 0);
    strictEqual(await store.take('jaina', rate), 0);
  });

  it('charges past the cap, and refuses hits until the overdraft refills', async () => {
    const { store, clock } = await make();
    strictEqual(await store.charge!('thrall', rate, 1), 0);
    strictEqual(await store.charge!('thrall', rate, 4), 2000);
    strictEqual(await store.take('thrall', rate), 2000);
    clock.now += 1000;
    strictEqual(await store.take('thrall', rate), 1000);
    clock.now += 1000;
    strictEqual(await store.take('thrall', rate), 0);
  });

  it('adds a charge to what a take already spent', async () => {
    const { store } = await make();
    await store.take('thrall', rate);
    strictEqual(await store.charge!('thrall', rate, 1), 500);
  });

  it('starts a charged key over when its rate changes', async () => {
    const { store } = await make();
    await store.charge!('thrall', rate, 10);
    strictEqual(await store.charge!('thrall', { limit: 1, window: 1000 }, 0), 0);
    strictEqual(await store.take('thrall', { limit: 1, window: 1000 }), 0);
  });

  it('stays exact for a large limit at epoch time', async () => {
    const { store } = await make();
    const large = { limit: 1_000_000, window: 3_600_000 };
    for (let i = 0; i < 3; i++) strictEqual(await store.take('thrall', large), 0);
    const tight = { limit: 7, window: 60_000 };
    for (let i = 0; i < 7; i++) strictEqual(await store.take('jaina', tight), 0);
    strictEqual(await store.take('jaina', tight), 8572);
  });
}
