import type { ConditionNode } from '../../../utils/index.ts';
import type { SQLValue, Transaction } from '../../database/adapter.ts';
import type { Dialect } from '../../database/dialect.ts';
import type { CollectionQueryMeta, FieldQueryMeta } from '../metadata.ts';

import { chunk, isUndefined } from '../../../utils/index.ts';
import { useDatabase, useDialect } from '../../database/use-database.ts';
import { effectiveLocale } from '../locale.ts';
import { queryMetadata } from '../metadata.ts';
import { compileFrom, conditionUsesCompanion } from '../sql/from.ts';
import { compileWhere } from '../sql/where.ts';
import {
  blockInstancesUnder,
  childRowsUnder,
  collectBlockSubtree,
  deleteBlockInstances,
  hasBlocksField,
  ownedBlockInstances,
  type BlockInstance,
} from './blocks.ts';
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
 * Block instances do not - their link is polymorphic, with no foreign key.
 * A collection holding blocks anywhere therefore pre-collects the matched records' instance subtrees.
 * They delete in the same transaction, leaving the per-type tables no orphans.
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
 * A collection holding blocks anywhere takes the instance-cleanup path instead.
 * The metadata walk decides, so a blocks-free collection keeps this single statement.
 */
async function attemptDelete(
  tx: Transaction,
  meta: CollectionQueryMeta,
  dialect: Dialect,
  condition: ConditionNode,
): Promise<DeleteOutcome> {
  const locale = effectiveLocale(null);
  if (hasBlocksField(meta.fields)) {
    return deleteWithBlocks(tx, meta, dialect, condition, locale);
  }
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
 * The delete attempt for a collection holding blocks anywhere in its composite tree.
 *
 * It resolves the matched set, walks the tree for the wrapper rows' instances, and collects each subtree.
 * All of it runs before the main `DELETE`, whose cascade takes the wrapper and child rows.
 * The per-type rows fall last: nothing references them anymore, and nothing cascades to them.
 */
async function deleteWithBlocks(
  tx: Transaction,
  meta: CollectionQueryMeta,
  dialect: Dialect,
  condition: ConditionNode,
  locale: string,
): Promise<DeleteOutcome> {
  const matched = await matchedUUIDs(tx, meta, dialect, condition, locale);
  if (matched.length === 0) return { deleted: 0 };
  const owned = await ownedBlockInstances(tx, dialect, meta.fields, matched);
  const doomed = await collectBlockSubtree(tx, dialect, owned);
  let deleted = 0;
  for (const batch of chunk(matched, 900)) {
    const marks = batch.map(() => '?').join(', ');
    const { changes } = await tx.run(
      `DELETE FROM ${dialect.quote(meta.table)} WHERE ${dialect.quote('UUID')} IN (${marks})`,
      [...batch],
    );
    deleted += changes;
  }
  await deleteBlockInstances(tx, dialect, doomed);
  return { deleted };
}

/**
 * Resolves the `UUID`s a condition matches, compiling the same `WHERE` clause the read path does.
 */
async function matchedUUIDs(
  tx: Transaction,
  meta: CollectionQueryMeta,
  dialect: Dialect,
  condition: ConditionNode,
  locale: string,
): Promise<string[]> {
  const where = compileWhere(condition, meta, dialect, locale);
  const from = compileFrom(meta, { condition }, locale, dialect);
  const uuid = `${dialect.quote(meta.table)}.${dialect.quote('UUID')}`;
  const rows = await tx.query<{ UUID: string }>(
    `SELECT ${uuid} AS ${dialect.quote('UUID')} ${from.sql} WHERE ${where.sql}`,
    [...from.params, ...where.params],
  );
  return rows.map((row) => row.UUID);
}

/**
 * Deletes every matching record's translation at `locale` and reports how many records held one.
 *
 * Removes the matched records' companion rows and locale-scoped derived rows at that locale alone.
 * The main rows and every other locale survive; nested derived rows cascade with their parents.
 * A translatable blocks field's instances go with its wrapper rows, subtrees included.
 * Nothing cascades to a per-type row, so the write layer deletes them in the same transaction.
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
 * A translatable blocks field's doomed instance subtrees collect before its wrapper rows go.
 * Blocks nested under a locale-scoped composite collect through the locale's own child rows.
 * The per-type rows delete after, once nothing places them.
 */
async function attemptDeleteTranslation(
  tx: Transaction,
  meta: CollectionQueryMeta,
  dialect: Dialect,
  condition: ConditionNode,
  locale: string,
): Promise<DeleteOutcome> {
  const matched = await matchedUUIDs(tx, meta, dialect, condition, locale);
  if (matched.length === 0) return { deleted: 0 };

  const scoped = Object.values(meta.fields).filter(
    (field) => field.localeScoped === true && field.inverse !== true,
  );
  const seeds: BlockInstance[] = [];
  for (const field of scoped) {
    if (field.kind === 'blocks') {
      seeds.push(
        ...(await blockInstancesUnder(tx, dialect, field.table as string, matched, locale)),
      );
      continue;
    }
    if (field.kind !== 'childOne' && field.kind !== 'childMany') continue;
    const subfields = field.subfields as Record<string, FieldQueryMeta>;
    if (!hasBlocksField(subfields)) continue;
    const rows = await childRowsUnder(tx, dialect, field.table as string, matched, locale);
    seeds.push(...(await ownedBlockInstances(tx, dialect, subfields, rows)));
  }
  const doomed = await collectBlockSubtree(tx, dialect, seeds);

  const tables = [
    ...(isUndefined(meta.companionTable) ? [] : [meta.companionTable]),
    ...scoped.map((field) => field.table as string),
  ];
  const affected = new Set<string>();
  for (const table of tables) {
    for (const uuids of await deleteLocaleRows(tx, dialect, table, matched, locale)) {
      affected.add(uuids);
    }
  }
  await deleteBlockInstances(tx, dialect, doomed);

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
