import type { DatabaseAdapter } from '../adapter.ts';
import type { Dialect, LockHandle } from '../dialect.ts';

import { isNull, isUndefined } from '../../../utils/index.ts';
import { ensureSchemaTable, readSnapshot, refuseIfSuperseded } from './snapshot.ts';

/**
 * Timing and identity of one instance's bid for the sync lock.
 */
export interface SyncLockOptions {
  /**
   * The hash of this instance's desired schema, compared when another instance finishes first.
   */
  desiredHash: string;

  /**
   * Milliseconds between polls of a held lock.
   *
   * @default
   * 250
   */
  pollInterval?: number;

  /**
   * Milliseconds after which a held lock counts as abandoned and its row may be stolen.
   * Must exceed the worst-case duration of a sync, or a slow one gets stolen mid-flight.
   *
   * @default
   * 60_000
   */
  staleAfter?: number;
}

const LOCK_KEY = 'sync';
const DEFAULT_POLL_INTERVAL = 250;
const DEFAULT_STALE_AFTER = 60_000;

/**
 * Races the cluster for the right to sync, waiting through the dialect while another instance holds it.
 * The winner gets the `LockHandle` its sync must release as the final in-transaction statement.
 * A loser waits; once the lock clears it compares the written snapshot against `desiredHash`.
 * A match returns `undefined` - the schema is already realized and the caller boots without syncing.
 * A hash found in the snapshot's history means this build was superseded: it refuses loudly.
 * Any other outcome re-races, covering a crashed winner and a schema the database has never seen.
 */
export async function acquireSyncLock(
  db: DatabaseAdapter,
  dialect: Dialect,
  options: SyncLockOptions,
): Promise<LockHandle | undefined> {
  const pollInterval = options.pollInterval ?? DEFAULT_POLL_INTERVAL;
  const staleAfter = options.staleAfter ?? DEFAULT_STALE_AFTER;
  await ensureSchemaTable(db, dialect);
  while (true) {
    const handle = await dialect.acquireLock(db, LOCK_KEY);
    if (!isNull(handle)) return handle;
    await dialect.waitForLock(db, LOCK_KEY, { pollInterval, staleAfter });
    const snapshot = await readSnapshot(db, dialect);
    if (isUndefined(snapshot)) continue;
    if (snapshot.hash === options.desiredHash) return undefined;
    refuseIfSuperseded(snapshot, options.desiredHash);
  }
}
