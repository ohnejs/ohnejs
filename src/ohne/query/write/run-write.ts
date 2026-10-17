import type { Transaction } from '../../database/adapter.ts';
import type { Dialect } from '../../database/dialect.ts';

import { isUndefined } from '../../../utils/index.ts';
import { useDatabase } from '../../database/use-database.ts';
import { busyError } from './busy.ts';
import { commitEffects, holdEffects, type RecordCommitted } from './committed.ts';
import { withSavepoint } from './savepoint.ts';

/**
 * Carries a failed outcome out of a self-owned transaction, so the throw rolls it back whole.
 */
class Unwound {
  readonly outcome: unknown;

  constructor(outcome: unknown) {
    this.outcome = outcome;
  }
}

/**
 * Runs a write terminal in one transaction bracket, self-owned or joined, behind one classification funnel.
 *
 * A self-owned call opens an `immediate` write transaction.
 * A joined call brackets `joinedTx` in a savepoint instead.
 * A failed outcome persists nothing: the transaction rolls back whole, or the savepoint unwinds.
 * Once a self-owned transaction commits, the commit effects its joined writes held fire, in write order.
 * `failed` tells which soft outcomes to unwind.
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
  const held: RecordCommitted[] = [];
  const run = isUndefined(joinedTx)
    ? () =>
        useDatabase().transaction(
          (tx) => holdEffects(tx, held, () => rollingBack(attempt(tx), failed)),
          'immediate',
        )
    : () => withSavepoint(joinedTx, failed, () => attempt(joinedTx));
  let outcome: T;
  try {
    outcome = await run();
  } catch (error) {
    if (error instanceof Unwound) return error.outcome as T;
    if (dialect.isBusy(error)) throw busyError(error);
    const classified = classify(error);
    if (!isUndefined(classified)) return classified;
    throw error;
  }
  for (const event of held) await commitEffects(event);
  return outcome;
}

/**
 * Awaits a self-owned attempt and throws a failed outcome as `Unwound`, rolling back what it already wrote.
 * A create with `locales` can fail at a later locale after the insert, so a soft failure must unwind too.
 */
async function rollingBack<T>(attempt: Promise<T>, failed: (outcome: T) => boolean): Promise<T> {
  const outcome = await attempt;
  if (failed(outcome)) throw new Unwound(outcome);
  return outcome;
}
