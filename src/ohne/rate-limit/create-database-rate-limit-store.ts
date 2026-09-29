import type { RateLimitStore } from '../../utils/index.ts';
import type { DatabaseName } from '../database/known-databases.ts';

import { useDatabase, useDialect } from '../database/use-database.ts';
import { busyError } from '../query/write/busy.ts';

/**
 * Options for `createDatabaseRateLimitStore`.
 */
export interface DatabaseRateLimitStoreOptions {
  /**
   * The helper database the counts live in, a name from `database.helpers`.
   */
  database: DatabaseName;

  /**
   * The clock hits are measured on, in epoch milliseconds.
   *
   * @default
   * Date.now
   */
  now?: () => number;
}

const SWEEP_BATCH = 1000;

const SWEEP_INTERVAL = 60_000;

/**
 * Creates a `RateLimitStore` that counts in a helper database, shared by every process that opens it.
 * Each hit or charge is one atomic upsert, so processes never both pass the last free hit.
 * Rows back at a full budget are swept in batches once a minute, and on each hit while a backlog remains.
 *
 * A busy database rejects with a busy error, which a request answers with `503`.
 *
 * @example
 * ```ts
 * const store = createDatabaseRateLimitStore({ database: 'rateLimits' })
 *
 * await store.take('thrall', { limit: 2, window: 1000 }) // -> 0
 * ```
 */
export function createDatabaseRateLimitStore({
  database,
  now = Date.now,
}: DatabaseRateLimitStoreOptions): RateLimitStore {
  let sweepAt = 0;

  /**
   * Deletes one batch of spent rows when a sweep is due; a busy database skips it.
   */
  const sweep = async (at: number): Promise<void> => {
    if (at < sweepAt) return;
    sweepAt = at + SWEEP_INTERVAL;
    try {
      const removed = await useDialect().sweepRateLimits(useDatabase(database), at, SWEEP_BATCH);
      if (removed === SWEEP_BATCH) sweepAt = at;
    } catch (error) {
      if (!useDialect().isBusy(error)) throw error;
    }
  };

  return {
    async take(key, rate) {
      const at = now();
      const wait = await busy(() =>
        useDialect().takeRateLimit(useDatabase(database), key, rate, at),
      );
      await sweep(at);
      return wait;
    },
    async charge(key, rate, cost) {
      const at = now();
      const wait = await busy(() =>
        useDialect().chargeRateLimit(useDatabase(database), key, rate, cost, at),
      );
      await sweep(at);
      return wait;
    },
    reset(key) {
      return busy(() => useDialect().resetRateLimit(useDatabase(database), key));
    },
    check() {
      return sweep(now());
    },
  };
}

/**
 * Runs `statement`, turning a busy database into the retryable busy error.
 */
async function busy<T>(statement: () => Promise<T>): Promise<T> {
  try {
    return await statement();
  } catch (error) {
    if (useDialect().isBusy(error)) throw busyError(error);
    throw error;
  }
}
