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
 * A key's count: when it was last allowed, and how much of its budget it held then.
 * `debt` is in `1 / limit` milliseconds, so one hit costs exactly `window` and the math stays in integers.
 */
interface Entry {
  at: number;
  debt: number;
}

/**
 * The keys counted at one rate, in write order, and when they are next swept.
 */
interface Bucket {
  window: number;
  entries: Map<string, Entry>;
  sweepAt: number;
}

// Each sweep starts a fresh iterator, which walks the holes that moved keys leave behind.
const SWEEP_INTERVAL = 1000;

/**
 * Creates a `RateLimitStore` that counts in this process's memory.
 * Each process, and each restart, counts on its own.
 * A key is forgotten within a second after one `window` passes without an allowed hit.
 *
 * @example
 * ```ts
 * const store = createMemoryRateLimitStore()
 * const rate = { limit: 2, window: 1000 }
 *
 * await store.take('thrall', rate) // -> 0
 * await store.take('thrall', rate) // -> 0
 * await store.take('thrall', rate) // -> 500
 * ```
 */
export function createMemoryRateLimitStore({
  now = Date.now,
}: MemoryRateLimitStoreOptions = {}): RateLimitStore {
  const buckets = new Map<string, Bucket>();

  return {
    async take(key, rate) {
      const at = now();
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
        bucket = { window: rate.window, entries: new Map(), sweepAt: at + SWEEP_INTERVAL };
        buckets.set(name, bucket);
      }

      const entry = bucket.entries.get(key);
      const next = held(entry, rate, at) + rate.window;
      const capacity = rate.limit * rate.window;
      if (next > capacity)
        return Math.ceil((next - capacity) / rate.limit) + Math.max((entry?.at ?? at) - at, 0);
      bucket.entries.delete(key);
      bucket.entries.set(key, { at: Math.max(entry?.at ?? at, at), debt: next });
      return 0;
    },
    async reset(key) {
      for (const bucket of buckets.values()) bucket.entries.delete(key);
    },
  };
}

/**
 * How much of its budget `entry` still holds at `at`, drained at `limit` per millisecond since its write.
 * A clock that stepped back drains nothing until it passes the write again.
 */
function held(entry: Entry | undefined, { limit, window }: RateLimitRate, at: number): number {
  if (isUndefined(entry) || at - entry.at >= window) return 0;
  if (at <= entry.at) return entry.debt;
  return Math.max(entry.debt - (at - entry.at) * limit, 0);
}

/**
 * Forgets keys from the oldest write on, stopping at the first one written within the last `window`.
 * A forgotten key is exactly as if it had never hit, so forgetting it never forgives anything.
 */
function sweep({ window, entries }: Bucket, at: number): void {
  for (const [key, entry] of entries) {
    if (entry.at + window > at) return;
    entries.delete(key);
  }
}
