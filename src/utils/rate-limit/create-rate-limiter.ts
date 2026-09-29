import type { RateLimitStore } from './rate-limit-store.ts';

import { parseDuration } from '../duration/parse-duration.ts';
import { isInteger } from '../is/is-integer.ts';
import { isPositiveInteger } from '../is/is-positive-integer.ts';
import { isUndefined } from '../is/is-undefined.ts';
import { createMemoryRateLimitStore } from './create-memory-rate-limit-store.ts';

/**
 * Options for `createRateLimiter`.
 */
export interface RateLimiterOptions {
  /**
   * How many hits a key may make in one `window`.
   */
  limit: number;

  /**
   * The span `limit` refills over, as milliseconds or a string like `'1m'`.
   */
  window: number | string;

  /**
   * Sets this limiter's keys apart from other limiters on the same `store`.
   *
   * @default
   * ''
   */
  name?: string;

  /**
   * Where the counts live.
   *
   * @default
   * createMemoryRateLimitStore()
   */
  store?: RateLimitStore;
}

/**
 * Counts hits per key and refuses a key past its budget.
 */
export interface RateLimiter {
  /**
   * Counts one hit against `key` and resolves `0` when it is allowed.
   * Past the budget it resolves the milliseconds until the next hit is allowed, and counts nothing.
   */
  hit(key: string): Promise<number>;

  /**
   * Counts `cost` hits against `key`, even past its budget, and resolves the milliseconds until the next hit.
   * `charge(key, 0)` counts nothing and only reads the wait.
   * It rejects when the store has no `charge`.
   * A negative or fractional `cost`, or one whose `cost * window` overflows a safe integer, rejects too.
   */
  charge(key: string, cost: number): Promise<number>;

  /**
   * Gives `key` its full budget back.
   */
  reset(key: string): Promise<void>;
}

/**
 * Creates a `RateLimiter`: each key gets `limit` hits per `window`, regaining one every `window / limit`.
 * A key may spend its whole budget at once; a refused hit costs nothing.
 * `charge` counts a weighted hit, such as tokens spent, even past the budget.
 *
 * `limit` and `window` must come to positive whole numbers, or it throws.
 *
 * @example
 * ```ts
 * const limiter = createRateLimiter({ limit: 2, window: '1s' })
 *
 * await limiter.hit('thrall') // -> 0
 * await limiter.hit('thrall') // -> 0
 * await limiter.hit('thrall') // -> 500
 * await limiter.hit('jaina')  // -> 0
 *
 * await limiter.charge('jaina', 3) // -> 1500
 * await limiter.charge('jaina', 0) // -> 1500
 * ```
 */
export function createRateLimiter({
  limit,
  name = '',
  store = createMemoryRateLimitStore(),
  ...options
}: RateLimiterOptions): RateLimiter {
  const window = parseDuration(options.window);
  if (!isPositiveInteger(limit)) throw new Error(`Invalid limit: ${limit}`);
  if (!isPositiveInteger(window) || !isInteger((limit + 1) * window))
    throw new Error(`Invalid window: ${options.window}`);

  const rate = { limit, window };
  const scoped = (key: string): string => JSON.stringify([name, key]);
  return {
    hit: (key) => store.take(scoped(key), rate),
    async charge(key, cost) {
      if (isUndefined(store.charge)) throw new Error('The rate-limit store has no `charge`');
      if (!isInteger(cost) || cost < 0 || !isInteger(cost * window))
        throw new Error(`Invalid cost: ${cost}`);
      return store.charge(scoped(key), rate, cost);
    },
    reset: (key) => store.reset(scoped(key)),
  };
}
