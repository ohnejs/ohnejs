import type { Transaction } from '../../database/adapter.ts';
import type { Dialect } from '../../database/dialect.ts';

import { isUndefined } from '../../../utils/index.ts';
import { useDatabase } from '../../database/use-database.ts';
import { busyError } from './busy.ts';
import { withSavepoint } from './savepoint.ts';

/**
 * Runs a write terminal in one transaction bracket, self-owned or joined, behind one classification funnel.
 *
 * A self-owned call opens an `immediate` write transaction; a joined call brackets `joinedTx` in a savepoint.
 * `failed` tells the savepoint which soft outcomes to unwind.
 * A create or update returns `{ ok: false }`; a delete only ever throws, so its predicate is constant.
 * A busy database always surfaces as a retryable `busyError`, whatever the terminal.
 * `classify` maps any remaining driver failure to a soft outcome or its own thrown error.
 * Returning `undefined` rethrows the original.
 */
export async function runWrite<T>(
  dialect: Dialect,
  joinedTx: Transaction | undefined,
  failed: (outcome: T) => boolean,
  attempt: (tx: Transaction) => Promise<T>,
  classify: (error: unknown) => T | undefined,
): Promise<T> {
  const run = isUndefined(joinedTx)
    ? () => useDatabase().transaction((tx) => attempt(tx), 'immediate')
    : () => withSavepoint(joinedTx, failed, () => attempt(joinedTx));
  try {
    return await run();
  } catch (error) {
    if (dialect.isBusy(error)) throw busyError(error);
    const classified = classify(error);
    if (!isUndefined(classified)) return classified;
    throw error;
  }
}
