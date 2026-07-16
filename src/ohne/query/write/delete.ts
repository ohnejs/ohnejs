import type { ConditionNode } from '../../../utils/index.ts';
import type { SQLValue, Transaction } from '../../database/adapter.ts';
import type { Dialect } from '../../database/dialect.ts';
import type { CollectionQueryMeta } from '../metadata.ts';

import { chunk, isUndefined } from '../../../utils/index.ts';
import { useDatabase, useDialect } from '../../database/use-database.ts';
import { effectiveLocale } from '../locale.ts';
import { queryMetadata } from '../metadata.ts';
import { compileFrom, conditionUsesCompanion } from '../sql/from.ts';
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
 * Every locale goes with the record: the companion rows cascade with the main row.
 * Child and junction rows follow through `ON DELETE CASCADE`.
 * A condition over translatable fields reads the default locale's values.
 * A locale-scoped chain has no `delete`, so this only ever runs unlocaled.
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
 * A `DELETE` cannot join.
 * A condition touching companion columns therefore narrows through `UUID IN (SELECT ...)`.
 */
async function attemptDelete(
  tx: Transaction,
  meta: CollectionQueryMeta,
  dialect: Dialect,
  condition: ConditionNode,
): Promise<DeleteOutcome> {
  const locale = effectiveLocale(null);
  const where = compileWhere(condition, meta, dialect, locale);
  const table = dialect.quote(meta.table);
  if (isUndefined(meta.companionTable) || !conditionUsesCompanion(condition, meta.fields)) {
    const { changes } = await tx.run(`DELETE FROM ${table} WHERE ${where.sql}`, where.params);
    return { deleted: changes };
  }
  const from = compileFrom(meta, { condition }, locale, dialect);
  const uuid = `${table}.${dialect.quote('UUID')}`;
  const { changes } = await tx.run(
    `DELETE FROM ${table} WHERE ${dialect.quote('UUID')} IN ` +
      `(SELECT ${uuid} ${from.sql} WHERE ${where.sql})`,
    [...from.params, ...where.params],
  );
  return { deleted: changes };
}

/**
 * Deletes every matching record's translation at `locale` and reports how many records held one.
 *
 * Removes the matched records' companion rows and locale-scoped derived rows at that locale alone.
 * The main rows and every other locale survive; nested derived rows cascade with their parents.
 * Each record that lost a row bumps its `_updatedAt` - a translation write touches its record.
 * A record with nothing stored at the locale is matched but uncounted: nothing changed.
 * A busy database surfaces as a retryable `busyError`.
 */
export async function runDeleteTranslation(
  collection: string,
  condition: ConditionNode,
  locale: string,
  joinedTx?: Transaction,
): Promise<DeleteOutcome> {
  const meta = queryMetadata(collection);
  const dialect = useDialect();
  const run = isUndefined(joinedTx)
    ? () =>
        useDatabase().transaction(
          (tx) => attemptDeleteTranslation(tx, meta, dialect, condition, locale),
          'immediate',
        )
    : () => attemptDeleteTranslation(joinedTx, meta, dialect, condition, locale);
  try {
    return await run();
  } catch (error) {
    if (dialect.isBusy(error)) throw busyError(error);
    throw error;
  }
}

/**
 * The translation-delete attempt inside the transaction.
 * It resolves the matched set at the locale, deletes the locale rows, and bumps the affected records.
 */
async function attemptDeleteTranslation(
  tx: Transaction,
  meta: CollectionQueryMeta,
  dialect: Dialect,
  condition: ConditionNode,
  locale: string,
): Promise<DeleteOutcome> {
  const where = compileWhere(condition, meta, dialect, locale);
  const from = compileFrom(meta, { condition }, locale, dialect);
  const uuid = `${dialect.quote(meta.table)}.${dialect.quote('UUID')}`;
  const rows = await tx.query<{ UUID: string }>(
    `SELECT ${uuid} AS ${dialect.quote('UUID')} ${from.sql} WHERE ${where.sql}`,
    [...from.params, ...where.params],
  );
  const matched = rows.map((row) => row.UUID);
  if (matched.length === 0) return { deleted: 0 };

  const tables = [
    ...(isUndefined(meta.companionTable) ? [] : [meta.companionTable]),
    ...Object.values(meta.fields)
      .filter((field) => field.localeScoped === true && field.inverse !== true)
      .map((field) => field.table as string),
  ];
  const affected = new Set<string>();
  for (const table of tables) {
    for (const uuids of await deleteLocaleRows(tx, dialect, table, matched, locale)) {
      affected.add(uuids);
    }
  }

  const bump = Date.now();
  for (const batch of chunk([...affected], 900)) {
    const marks = batch.map(() => '?').join(', ');
    await tx.run(
      `UPDATE ${dialect.quote(meta.table)} SET ${dialect.quote('_updatedAt')} = ? ` +
        `WHERE ${dialect.quote('UUID')} IN (${marks})`,
      [bump, ...batch],
    );
  }
  return { deleted: affected.size };
}

/**
 * Deletes one locale-carrying table's rows under the matched parents at `locale`.
 * Returns the distinct parents that actually held rows there.
 */
async function deleteLocaleRows(
  tx: Transaction,
  dialect: Dialect,
  table: string,
  parents: readonly string[],
  locale: string,
): Promise<string[]> {
  const quoted = dialect.quote(table);
  const parent = dialect.quote('_parentUUID');
  const scoped = `${dialect.quote('_localeCode')} = ?`;
  const affected: string[] = [];
  for (const batch of chunk(parents, 900)) {
    const marks = batch.map(() => '?').join(', ');
    const params: SQLValue[] = [...batch, locale];
    const rows = await tx.query<{ parent: string }>(
      `SELECT DISTINCT ${parent} AS ${dialect.quote('parent')} FROM ${quoted} ` +
        `WHERE ${parent} IN (${marks}) AND ${scoped}`,
      params,
    );
    if (rows.length === 0) continue;
    await tx.run(`DELETE FROM ${quoted} WHERE ${parent} IN (${marks}) AND ${scoped}`, params);
    affected.push(...rows.map((row) => row.parent));
  }
  return affected;
}
