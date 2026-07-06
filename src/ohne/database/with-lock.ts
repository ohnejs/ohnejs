import type { LockHandle } from './dialect.ts';

import { isNull } from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';
import { useDatabase, useDialect } from './use-database.ts';

/**
 * Timing of one `withLock` bid.
 */
export interface WithLockOptions {
  /**
   * Milliseconds between polls of a held lock.
   *
   * @default
   * 250
   */
  pollInterval?: number;

  /**
   * Milliseconds after which a held lock counts as abandoned and is taken over.
   * Must exceed the worst-case duration of the guarded work, or a slow holder loses the lock mid-run.
   *
   * @default
   * 60_000
   */
  staleAfter?: number;
}

const RESERVED_KEY = 'sync';
const DEFAULT_POLL_INTERVAL = 250;
const DEFAULT_STALE_AFTER = 60_000;

/**
 * Runs `fn` while holding the named cluster lock, releasing it when `fn` settles.
 *
 * The lock is a row in the main database, so it excludes every instance of the app, not just this process.
 * A held lock is waited out; an abandoned one, older than `staleAfter`, is taken over.
 * Not reentrant: nesting `withLock` on one key stalls until the inner call steals the outer lock.
 * The `sync` key is reserved for the schema sync.
 *
 * @example
 * ```ts
 * await withLock('emails:digest', () => sendDailyDigest())
 * ```
 */
export async function withLock<T>(
  key: string,
  fn: () => T | Promise<T>,
  options: WithLockOptions = {},
): Promise<T> {
  if (key === RESERVED_KEY) {
    throw ohneError('The lock key `sync` is reserved for the schema sync');
  }
  const db = useDatabase();
  const dialect = useDialect();
  const timing = {
    pollInterval: options.pollInterval ?? DEFAULT_POLL_INTERVAL,
    staleAfter: options.staleAfter ?? DEFAULT_STALE_AFTER,
  };
  let handle: LockHandle | null = null;
  while (isNull(handle)) {
    try {
      handle = await dialect.acquireLock(db, key);
    } catch (error) {
      if (!dialect.isBusy(error)) throw error;
    }
    if (isNull(handle)) await dialect.waitForLock(db, key, timing);
  }
  try {
    return await fn();
  } finally {
    await dialect.releaseLock(db, handle);
  }
}
