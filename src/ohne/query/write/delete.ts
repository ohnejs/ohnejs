import type { ConditionNode } from '../../../utils/index.ts';
import type { Transaction } from '../../database/adapter.ts';
import type { Dialect } from '../../database/dialect.ts';
import type { CollectionQueryMeta } from '../metadata.ts';

import { isUndefined } from '../../../utils/index.ts';
import { useDatabase, useDialect } from '../../database/use-database.ts';
import { queryMetadata } from '../metadata.ts';
import { compileWhere } from '../sql/where.ts';
import { busyError } from './busy.ts';
import { referenceViolation } from './errors.ts';

/**
 * The outcome of a delete: how many records the condition matched and removed.
 */
export interface DeleteOutcome {
  /**
   * The number of records deleted.
   */
  deleted: number;
}

/**
 * Deletes every record the condition matches and reports the count.
 *
 * Child and junction rows follow through `ON DELETE CASCADE`.
 * A `record` reference elsewhere follows its own `onDelete`.
 * A `restrict` reference still pointing at a matched row throws a `referenceViolation`, an HTTP `409`.
 * A busy database surfaces as a retryable `busyError`.
 * Delete has no validation phase, so the result is only the count.
 */
export async function runDelete(
  collection: string,
  condition: ConditionNode,
  joinedTx?: Transaction,
): Promise<DeleteOutcome> {
  const meta = queryMetadata(collection);
  const dialect = useDialect();
  const run = isUndefined(joinedTx)
    ? () =>
        useDatabase().transaction((tx) => attemptDelete(tx, meta, dialect, condition), 'immediate')
    : () => attemptDelete(joinedTx, meta, dialect, condition);
  try {
    return await run();
  } catch (error) {
    if (dialect.isBusy(error)) throw busyError(error);
    if (dialect.isForeignKeyViolation(error)) throw referenceViolation(error);
    throw error;
  }
}

/**
 * The delete attempt inside the transaction, compiling the same `WHERE` clause the read path does.
 */
async function attemptDelete(
  tx: Transaction,
  meta: CollectionQueryMeta,
  dialect: Dialect,
  condition: ConditionNode,
): Promise<DeleteOutcome> {
  const where = compileWhere(condition, meta, dialect);
  const { changes } = await tx.run(
    `DELETE FROM ${dialect.quote(meta.table)} WHERE ${where.sql}`,
    where.params,
  );
  return { deleted: changes };
}
