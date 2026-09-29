import type { RateLimitRate, RateLimitStore } from './rate-limit-store.ts';

import { isUndefined } from '../is/is-undefined.ts';

/**
 * Options for `createMemoryRateLimitStore`.
 */
export interface MemoryRateLimitStoreOptions {
  /**
   * The clock hits are measured on, in epoch milliseconds.
   *
   * @default
   * Date.now
   */
  now?: () => number;
}

/**
 * A key's count: when it was last written, and how much budget it owed then.
 * `debt` is in `1 / limit` milliseconds, so one hit costs exactly `window` and the math stays in integers.
 * A charged key may owe more than its whole budget.
 */
interface Entry {
  at: number;
  debt: number;
}

/**
 * The keys counted at one rate, in write order, and when they are next swept.
 */
interface Bucket {
  rate: RateLimitRate;
  entries: Map<string, Entry>;
  sweepAt: number;
}

// Each sweep starts a fresh iterator, which walks the holes that moved keys leave behind.
const SWEEP_INTERVAL = 1000;

/**
 * Creates a `RateLimitStore` that counts in this process's memory.
 * Each process, and each restart, counts on its own.
 * A key is forgotten once a `window` has passed since its last write and it owes nothing.
 * Sweeps run about once a second, in write order.
 *
 * @example
 * ```ts
 * const store = createMemoryRateLimitStore()
 * const rate = { limit: 2, window: 1000 }
 *
 * await store.take('thrall', rate)     // -> 0
 * await store.take('thrall', rate)     // -> 0
 * await store.take('thrall', rate)     // -> 500
 * await store.charge('jaina', rate, 3) // -> 1000
 * ```
 */
export function createMemoryRateLimitStore({
  now = Date.now,
}: MemoryRateLimitStoreOptions = {}): RateLimitStore {
  const buckets = new Map<string, Bucket>();

  /**
   * Returns the bucket for `rate`, dropping `key` from every other rate and sweeping the buckets due.
   */
  const bucketOf = (key: string, rate: RateLimitRate, at: number): Bucket => {
    const name = `${rate.limit}/${rate.window}`;
    for (const [other, bucket] of buckets) {
      if (other !== name) bucket.entries.delete(key);
      if (at < bucket.sweepAt) continue;
      bucket.sweepAt = at + SWEEP_INTERVAL;
      sweep(bucket, at);
      if (bucket.entries.size === 0) buckets.delete(other);
    }
    let bucket = buckets.get(name);
    if (isUndefined(bucket)) {
      bucket = { rate, entries: new Map(), sweepAt: at + SWEEP_INTERVAL };
      buckets.set(name, bucket);
    }
    return bucket;
  };

  return {
    async take(key, rate) {
      const at = now();
      const { entries } = bucketOf(key, rate, at);
      const entry = entries.get(key);
      const refused = wait(entry, rate, at);
      if (refused > 0) return refused;
      write(entries, key, {
        at: Math.max(entry?.at ?? at, at),
        debt: held(entry, rate, at) + rate.window,
      });
      return 0;
    },
    async charge(key, rate, cost) {
      const at = now();
      const { entries } = bucketOf(key, rate, at);
      let entry = entries.get(key);
      if (cost > 0) {
        entry = {
          at: Math.max(entry?.at ?? at, at),
          debt: held(entry, rate, at) + cost * rate.window,
        };
        write(entries, key, entry);
      }
      return wait(entry, rate, at);
    },
    async reset(key) {
      for (const bucket of buckets.values()) bucket.entries.delete(key);
    },
  };
}

/**
 * How much budget `entry` still owes at `at`, drained at `limit` per millisecond since its write.
 * A clock that stepped back drains nothing until it passes the write again.
 */
function held(entry: Entry | undefined, { limit }: RateLimitRate, at: number): number {
  if (isUndefined(entry)) return 0;
  if (at <= entry.at) return entry.debt;
  return Math.max(entry.debt - (at - entry.at) * limit, 0);
}

/**
 * The whole milliseconds from `at` until `entry` has room for one more hit, `0` when it has room now.
 */
function wait(entry: Entry | undefined, rate: RateLimitRate, at: number): number {
  const over = held(entry, rate, at) + rate.window - rate.limit * rate.window;
  if (over <= 0) return 0;
  return Math.ceil(over / rate.limit) + Math.max((entry?.at ?? at) - at, 0);
}

/**
 * Stores `entry` as the newest write, so `entries` stays in write order.
 */
function write(entries: Map<string, Entry>, key: string, entry: Entry): void {
  entries.delete(key);
  entries.set(key, entry);
}

/**
 * Forgets keys from the oldest write on, stopping at the first one written within the last `window`.
 * A key that still owes budget is skipped, since a charge can outlast the window.
 * A forgotten key is exactly as if it had never hit, so forgetting it never forgives anything.
 */
function sweep({ rate, entries }: Bucket, at: number): void {
  for (const [key, entry] of entries) {
    if (entry.at + rate.window > at) return;
    if (held(entry, rate, at) === 0) entries.delete(key);
  }
}
