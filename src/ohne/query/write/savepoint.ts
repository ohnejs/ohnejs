import type { Transaction } from '../../database/adapter.ts';

import { dropHeld, heldCount } from './committed.ts';

/**
 * Runs a joined-transaction write inside a savepoint, so a failure unwinds only this write.
 *
 * The write terminals promise that a failed call persists nothing.
 * A self-owned transaction rolls back whole; a joined one must not, since the caller still holds it.
 * The savepoint scopes the unwind: a throw or a `failed` outcome rolls back to it, then releases it.
 * A success releases it plainly, leaving the write pending in the caller's transaction.
 * An unwind also drops the commit effects held since the savepoint, so a rolled-back write never announces.
 * `SAVEPOINT` nests by name in SQLite and Postgres alike, so joined writes may themselves nest.
 */
export async function withSavepoint<T>(
  tx: Transaction,
  failed: (outcome: T) => boolean,
  fn: () => Promise<T>,
): Promise<T> {
  const mark = heldCount(tx);
  await tx.run('SAVEPOINT ohne_write');
  try {
    const outcome = await fn();
    if (failed(outcome)) {
      await tx.run('ROLLBACK TO ohne_write');
      dropHeld(tx, mark);
    }
    await tx.run('RELEASE ohne_write');
    return outcome;
  } catch (error) {
    dropHeld(tx, mark);
    try {
      await tx.run('ROLLBACK TO ohne_write');
      await tx.run('RELEASE ohne_write');
    } catch {
      // The unwind failed with the connection; the original failure is the one to surface.
    }
    throw error;
  }
}
