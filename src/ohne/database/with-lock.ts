import { AsyncLocalStorage } from 'node:async_hooks';

import type { DatabaseAdapter } from './adapter.ts';
import type { Dialect, LockHandle } from './dialect.ts';

import { isNull, isUndefined } from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';
import { useDatabase, useDialect } from './use-database.ts';

/**
 * How one `withLock` call bids for its lock.
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
   * Whether to wait while another holder has the lock.
   * `false` resolves `undefined` at once instead, without running the function.
   *
   * @default
   * true
   */
  wait?: boolean;
}

/**
 * A lock one call chain holds, linked to the lock it was taken under.
 */
type HeldLock = { key: string; held: boolean; outer: HeldLock | undefined };

const RESERVED_KEY = 'sync';
const DEFAULT_POLL_INTERVAL = 250;
const STALE_AFTER = 20_000;
// Three renewals may fail, as a busy database stalls each for seconds, before a live holder is lost.
const RENEW_INTERVAL = STALE_AFTER / 4;
const chain = new AsyncLocalStorage<HeldLock>();

/**
 * Runs `fn` while holding the named cluster lock, releasing it when `fn` settles.
 *
 * The lock is a row in the main database, so it excludes every instance of the app, not just this process.
 * A held lock is waited out, or with `wait: false` skipped, resolving `undefined` without running `fn`.
 * The lock is renewed while `fn` runs, so `fn` may take as long as it needs.
 * A renewal waits out an open transaction, so each transaction inside `fn` must stay under 20 seconds.
 * A holder that crashed stops renewing, and the next bid takes its lock over within 20 seconds.
 * Not reentrant: a call on a key its call chain holds throws, even from work `fn` did not await.
 * The `sync` key is reserved for the schema sync.
 *
 * @example
 * ```ts
 * await withLock('emails:digest', () => sendDailyDigest())
 *
 * await withLock('cache:prune', () => pruneCache(), { wait: false })
 * // -> undefined while another instance prunes
 * ```
 */
export function withLock<T>(
  key: string,
  fn: () => T | Promise<T>,
  options: WithLockOptions & { wait: false },
): Promise<T | undefined>;
export function withLock<T>(
  key: string,
  fn: () => T | Promise<T>,
  options?: WithLockOptions & { wait?: true },
): Promise<T>;
export function withLock<T>(
  key: string,
  fn: () => T | Promise<T>,
  options?: WithLockOptions,
): Promise<T | undefined>;
export async function withLock<T>(
  key: string,
  fn: () => T | Promise<T>,
  options: WithLockOptions = {},
): Promise<T | undefined> {
  if (key === RESERVED_KEY) {
    throw ohneError('The lock key `sync` is reserved for the schema sync');
  }
  const outer = chain.getStore();
  if (holds(outer, key)) {
    throw ohneError(`\`withLock\` is not reentrant: \`${key}\` is already held here`);
  }
  const db = useDatabase();
  const dialect = useDialect();
  const handle = await take(db, dialect, key, options);
  if (isNull(handle)) return undefined;
  const renewal = setInterval(() => {
    // A failed renewal skips a beat, and the next one retries.
    dialect.renewLock(db, handle).catch(() => undefined);
  }, RENEW_INTERVAL).unref();
  const link: HeldLock = { key, held: true, outer };
  try {
    return await chain.run(link, fn);
  } finally {
    link.held = false;
    clearInterval(renewal);
    await dialect.releaseLock(db, handle);
  }
}

/**
 * Bids for `key` until this call holds it, or once without `wait`, resolving the handle or `null`.
 */
async function take(
  db: DatabaseAdapter,
  dialect: Dialect,
  key: string,
  { wait = true, pollInterval = DEFAULT_POLL_INTERVAL }: WithLockOptions,
): Promise<LockHandle | null> {
  let handle = await bid(db, dialect, key);
  while (wait && isNull(handle)) {
    await dialect.waitForLock(db, key, { pollInterval, staleAfter: STALE_AFTER });
    handle = await bid(db, dialect, key);
  }
  return handle;
}

/**
 * Bids once for `key`, taking over a lock whose holder stopped renewing it.
 * Resolves the handle, or `null` while a live holder keeps the key or the database is busy.
 */
async function bid(db: DatabaseAdapter, dialect: Dialect, key: string): Promise<LockHandle | null> {
  try {
    const handle = await dialect.acquireLock(db, key);
    if (!isNull(handle)) return handle;
    const free = await dialect.releaseAbandonedLock(db, key, STALE_AFTER);
    return free ? await dialect.acquireLock(db, key) : null;
  } catch (error) {
    if (!dialect.isBusy(error)) throw error;
    return null;
  }
}

/**
 * Whether `key` is held by the lock `link` or one it was taken under.
 * A released link no longer counts, so work it started may take the key once it is free.
 */
function holds(link: HeldLock | undefined, key: string): boolean {
  for (let at = link; !isUndefined(at); at = at.outer) {
    if (at.held && at.key === key) return true;
  }
  return false;
}
