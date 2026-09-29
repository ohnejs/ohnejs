import { deepStrictEqual, rejects, strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import type { RateLimitRate, RateLimitStore } from '../../../src/utils/index.ts';

import { createMemoryRateLimitStore, createRateLimiter } from '../../../src/utils/index.ts';

function recording(): { store: RateLimitStore; taken: [string, RateLimitRate, number][] } {
  const taken: [string, RateLimitRate, number][] = [];
  return {
    taken,
    store: {
      async take(key, rate) {
        taken.push([key, rate, 1]);
        return 0;
      },
      async charge(key, rate, cost) {
        taken.push([key, rate, cost]);
        return 0;
      },
      async reset() {},
    },
  };
}

describe('createRateLimiter', () => {
  it('allows a burst of limit, then answers the wait', async () => {
    const store = createMemoryRateLimitStore({ now: () => 0 });
    const limiter = createRateLimiter({ limit: 2, window: '1s', store });
    strictEqual(await limiter.hit('thrall'), 0);
    strictEqual(await limiter.hit('thrall'), 0);
    strictEqual(await limiter.hit('thrall'), 500);
    strictEqual(await limiter.hit('jaina'), 0);
  });

  it('passes the parsed rate and a name-scoped key to its store', async () => {
    const { store, taken } = recording();
    await createRateLimiter({ name: 'login', limit: 5, window: '1m', store }).hit('2001:db8::/64');
    deepStrictEqual(taken, [['["login","2001:db8::/64"]', { limit: 5, window: 60_000 }, 1]]);
  });

  it('counts two names on one store apart', async () => {
    const store = createMemoryRateLimitStore({ now: () => 0 });
    const a = createRateLimiter({ name: 'a', limit: 1, window: 1000, store });
    const b = createRateLimiter({ name: 'b', limit: 1, window: 1000, store });
    strictEqual(await a.hit('thrall'), 0);
    strictEqual(await b.hit('thrall'), 0);
    strictEqual(await a.hit('thrall'), 1000);
  });

  it('keeps a key with a separator in it apart from a different name', async () => {
    const store = createMemoryRateLimitStore({ now: () => 0 });
    const a = createRateLimiter({ name: 'a:b', limit: 1, window: 1000, store });
    const b = createRateLimiter({ name: 'a', limit: 1, window: 1000, store });
    await a.hit('c');
    strictEqual(await b.hit('b:c'), 0);
  });

  it('gives a key its full budget back on reset', async () => {
    const limiter = createRateLimiter({ limit: 1, window: 1000 });
    await limiter.hit('thrall');
    await limiter.reset('thrall');
    strictEqual(await limiter.hit('thrall'), 0);
  });

  it('throws on a limit or window that is not a positive whole number', () => {
    for (const limit of [0, -1, 1.5, Number.NaN])
      throws(() => createRateLimiter({ limit, window: 1000 }), /Invalid limit/);
    for (const window of [0, 1.5, '0s', '1.5ms'])
      throws(() => createRateLimiter({ limit: 1, window }), /Invalid window/);
    for (const window of [-1, Number.NaN, 'soon'])
      throws(() => createRateLimiter({ limit: 1, window }), /Invalid duration/);
    throws(() => createRateLimiter({ limit: 2 ** 30, window: 2 ** 30 }), /Invalid window/);
  });

  it('charges a weighted hit past the budget, and probes with 0', async () => {
    const store = createMemoryRateLimitStore({ now: () => 0 });
    const limiter = createRateLimiter({ limit: 2, window: '1s', store });
    strictEqual(await limiter.hit('jaina'), 0);
    strictEqual(await limiter.charge('jaina', 3), 1500);
    strictEqual(await limiter.charge('jaina', 0), 1500);
    strictEqual(await limiter.hit('jaina'), 1500);
  });

  it('passes the rate, a name-scoped key and the cost to its store', async () => {
    const { store, taken } = recording();
    await createRateLimiter({ name: 'tokens', limit: 5, window: '1m', store }).charge('thrall', 7);
    deepStrictEqual(taken, [['["tokens","thrall"]', { limit: 5, window: 60_000 }, 7]]);
  });

  it('rejects a charge on a store without `charge`', async () => {
    const limiter = createRateLimiter({
      limit: 1,
      window: 1000,
      store: { take: async () => 0, reset: async () => {} },
    });
    await rejects(limiter.charge('thrall', 1), /has no `charge`/);
  });

  it('rejects a cost that is not a whole number of zero or more', async () => {
    const limiter = createRateLimiter({ limit: 1, window: 1000 });
    for (const cost of [-1, 1.5, Number.NaN, 2 ** 53])
      await rejects(limiter.charge('thrall', cost), /Invalid cost/);
  });
});
