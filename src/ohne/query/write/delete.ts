import type { ConditionNode } from '../../../utils/index.ts';
import type { CollectionName } from '../../collections/known-collections.ts';
import type { SQLValue, Transaction } from '../../database/adapter.ts';
import type { Dialect } from '../../database/dialect.ts';
import type { CollectionQueryMeta, FieldQueryMeta } from '../metadata.ts';

import { chunk, isUndefined } from '../../../utils/index.ts';
import { useCollections } from '../../collections/use-collections.ts';
import { useDialect } from '../../database/use-database.ts';
import { applyHook } from '../../hooks/apply-hook.ts';
import { useHooks } from '../../hooks/use-hooks.ts';
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
import { commitEffects } from './committed.ts';
import { referenceViolation } from './errors.ts';
import { runWrite } from './run-write.ts';
import { scopeCondition } from './update.ts';

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
 * The context the pre-delete hook fires with, carrying the rows a delete is about to remove.
 */
export interface RecordDeleteContext {
  /**
   * The collection being deleted from, by name.
   */
  collection: CollectionName;

  /**
   * The `WHERE` condition the delete matched on, already scoped by `record:condition`.
   */
  condition: ConditionNode;

  /**
   * The `UUID`s of the records this delete will remove.
   */
  matched: readonly string[];

  /**
   * The open write transaction, so a callback cleans up dependent rows atomically.
   */
  tx: Transaction;
}

declare module 'ohnejs' {
  interface Hooks {
    /**
     * Runs just before a delete removes its rows, inside the transaction, carrying the doomed `UUID`s.
     * Fires only when it or `record:committed` has a subscriber; else the fast delete never lists them.
     * Use it to clean up rows outside the cascade - an external mirror, a derived table - on the same `tx`.
     * A `deleteTranslation` never fires it, since every record it matches survives.
     * An action: its return is ignored, and the delete proceeds once every callback settles.
     * The `ctx` carries the `collection`, the scoped `condition`, the `matched` UUIDs, and the open `tx`.
     */
    'record:before-delete': (ctx: RecordDeleteContext) => void | Promise<void>;
  }
}

/**
 * The count a delete or translation delete reports, plus the `UUID`s it touched when an effect needs them.
 */
interface DeleteResult {
  deleted: number;
  uuids: readonly string[];
}

/**
 * Whether the delete must list its matched `UUID`s: only when a pre-delete or commit effect subscribes.
 * The fast path issues one statement and materializes nothing otherwise.
 */
function wantsDeletedUUIDs(): boolean {
  const before = useHooks().get('record:before-delete');
  const committed = useHooks().get('record:committed');
  return (
    (!isUndefined(before) && before.length > 0) || (!isUndefined(committed) && committed.length > 0)
  );
}

/**
 * Runs the `record:before-delete` effects for the doomed rows, skipping when nothing subscribes.
 */
async function beforeDelete(ctx: RecordDeleteContext): Promise<void> {
  const callbacks = useHooks().get('record:before-delete');
  if (isUndefined(callbacks) || callbacks.length === 0) return;
  await applyHook('record:before-delete', ctx);
}

/**
 * Deletes every record the condition matches and reports the count.
 *
 * Every locale goes with the record: the companion rows cascade with the main row.
 * Child and junction rows follow through `ON DELETE CASCADE`.
 * Block instances do not - their link is polymorphic, with no foreign key.
 * A collection holding blocks anywhere therefore pre-collects the matched records' instance subtrees.
 * Rows other collections lose through a cascade `record` edge pre-collect theirs the same way.
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
  const scoped = await scopeCondition(collection, condition, 'delete');
  const outcome = await runWrite<DeleteResult>(
    dialect,
    joinedTx,
    () => false,
    (tx) => attemptDelete(tx, meta, dialect, scoped),
    (error) => {
      if (dialect.isForeignKeyViolation(error)) throw referenceViolation(error);
      return undefined;
    },
  );
  if (isUndefined(joinedTx)) {
    await commitEffects({
      collection: collection as CollectionName,
      operation: 'delete',
      uuids: outcome.uuids,
    });
  }
  return { deleted: outcome.deleted };
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
): Promise<DeleteResult> {
  const locale = effectiveLocale(null);
  if (hasBlocksField(meta.fields) || cascadeReachesBlocks(meta.collection)) {
    return deleteWithBlocks(tx, meta, dialect, condition, locale);
  }
  if (wantsDeletedUUIDs()) {
    const matched = await matchedUUIDs(tx, meta, dialect, condition, locale);
    if (matched.length === 0) return { deleted: 0, uuids: [] };
    await beforeDelete({ collection: meta.collection as CollectionName, condition, matched, tx });
    let deleted = 0;
    for (const batch of chunk(matched, 900)) {
      const marks = batch.map(() => '?').join(', ');
      const { changes } = await tx.run(
        `DELETE FROM ${dialect.quote(meta.table)} WHERE ${dialect.quote('UUID')} IN (${marks})`,
        [...batch],
      );
      deleted += changes;
    }
    return { deleted, uuids: matched };
  }
  const where = compileWhere(condition, meta, dialect, locale);
  const table = dialect.quote(meta.table);
  if (isUndefined(meta.companionTable) || !conditionUsesCompanion(condition, meta.fields)) {
    const { changes } = await tx.run(`DELETE FROM ${table} WHERE ${where.sql}`, where.params);
    return { deleted: changes, uuids: [] };
  }
  const from = compileFrom(meta, { condition }, locale, dialect);
  const uuid = `${table}.${dialect.quote('UUID')}`;
  const { changes } = await tx.run(
    `DELETE FROM ${table} WHERE ${dialect.quote('UUID')} IN ` +
      `(SELECT ${uuid} ${from.sql} WHERE ${where.sql})`,
    [...from.params, ...where.params],
  );
  return { deleted: changes, uuids: [] };
}

/**
 * The delete attempt for a delete that dooms blocks - its own tree's, or a cascade edge's.
 *
 * It resolves the matched set, walks the tree for the wrapper rows' instances, and collects each subtree.
 * Rows other collections lose through `ON DELETE CASCADE` contribute theirs through the edge walk.
 * All of it runs before the main `DELETE`, whose cascade takes the wrapper and child rows.
 * The per-type rows fall last: nothing references them anymore, and nothing cascades to them.
 */
async function deleteWithBlocks(
  tx: Transaction,
  meta: CollectionQueryMeta,
  dialect: Dialect,
  condition: ConditionNode,
  locale: string,
): Promise<DeleteResult> {
  const matched = await matchedUUIDs(tx, meta, dialect, condition, locale);
  if (matched.length === 0) return { deleted: 0, uuids: [] };
  const owned = await ownedBlockInstances(tx, dialect, meta.fields, matched);
  const cascaded = await cascadeDoomedInstances(tx, dialect, meta.collection, matched);
  const doomed = await collectBlockSubtree(tx, dialect, [...owned, ...cascaded]);
  await beforeDelete({ collection: meta.collection as CollectionName, condition, matched, tx });
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
  return { deleted, uuids: matched };
}

/**
 * One declared cascade edge into a collection: deleting its rows deletes rows of `table` too.
 * `fields` is the dying scope's field map, walked for the block instances those rows place.
 * `collection` is set when `table` is a collection's main table, so the closure can recurse.
 */
interface CascadeEdge {
  table: string;
  column: string;
  fields: Record<string, FieldQueryMeta>;
  collection?: string;
}

/**
 * The per-target cascade-edge memo, living and dying with the registries like the metadata cache.
 */
const edgeCache = new Map<string, CascadeEdge[]>();

/**
 * Every declared cascade edge into `target`, resolved once from the registries and memoized.
 * A `record` field with `onDelete: 'cascade'` contributes its main or child table.
 * Blocks never hold cascade `record` fields - the metadata build rejects them - so they add none.
 */
function cascadeEdgesInto(target: string): CascadeEdge[] {
  const cached = edgeCache.get(target);
  if (!isUndefined(cached)) return cached;
  const edges: CascadeEdge[] = [];
  for (const name of Object.keys(useCollections().all())) {
    const meta = queryMetadata(name);
    collectEdges(edges, target, meta.fields, meta.table, name);
  }
  edgeCache.set(target, edges);
  return edges;
}

/**
 * Collects one scope's cascade edges into `target`, recursing through its composite subfields.
 */
function collectEdges(
  edges: CascadeEdge[],
  target: string,
  fields: Record<string, FieldQueryMeta>,
  table: string,
  collection?: string,
): void {
  for (const field of Object.values(fields)) {
    if (
      field.kind === 'record' &&
      field.target === target &&
      field.options?.onDelete === 'cascade'
    ) {
      edges.push({
        table,
        column: field.column as string,
        fields,
        ...(isUndefined(collection) ? {} : { collection }),
      });
    }
    if (field.kind === 'childOne' || field.kind === 'childMany') {
      collectEdges(
        edges,
        target,
        field.subfields as Record<string, FieldQueryMeta>,
        field.table as string,
      );
    }
  }
}

/**
 * Whether any cascade edge into `target`, transitively, dooms a scope holding blocks.
 * Decides whether a delete of a blocks-free collection still needs the instance-cleanup path.
 */
function cascadeReachesBlocks(target: string, seen: Set<string> = new Set([target])): boolean {
  return cascadeEdgesInto(target).some((edge) => {
    if (hasBlocksField(edge.fields)) return true;
    if (isUndefined(edge.collection) || seen.has(edge.collection)) return false;
    seen.add(edge.collection);
    return cascadeReachesBlocks(edge.collection, seen);
  });
}

/**
 * The block-instance seeds the database's cascade edges will doom beneath the matched rows.
 *
 * The main `DELETE` cascades referencing rows away at the constraint level, wrapper rows included.
 * The polymorphic per-type rows stay, so the write layer collects and deletes them itself.
 * Each edge reads its doomed rows and gathers the blocks their subtrees place.
 * A doomed collection then recurses through its own in-edges.
 * A visited set per collection keeps a cascade cycle from re-walking rows.
 */
async function cascadeDoomedInstances(
  tx: Transaction,
  dialect: Dialect,
  collection: string,
  matched: readonly string[],
): Promise<BlockInstance[]> {
  const doomed: BlockInstance[] = [];
  const visited = new Map<string, Set<string>>([[collection, new Set(matched)]]);
  await walkCascade(tx, dialect, collection, matched, doomed, visited);
  return doomed;
}

/**
 * One closure step: resolves each in-edge's doomed rows, collects their blocks, and recurses.
 */
async function walkCascade(
  tx: Transaction,
  dialect: Dialect,
  collection: string,
  uuids: readonly string[],
  doomed: BlockInstance[],
  visited: Map<string, Set<string>>,
): Promise<void> {
  for (const edge of cascadeEdgesInto(collection)) {
    const wantsBlocks = hasBlocksField(edge.fields);
    const recurses = !isUndefined(edge.collection) && cascadeEdgesInto(edge.collection).length > 0;
    if (!wantsBlocks && !recurses) continue;
    const rows = await rowsReferencing(tx, dialect, edge.table, edge.column, uuids);
    if (rows.length === 0) continue;
    if (wantsBlocks) {
      doomed.push(...(await ownedBlockInstances(tx, dialect, edge.fields, rows)));
    }
    if (isUndefined(edge.collection)) continue;
    const seen = visited.get(edge.collection) ?? new Set<string>();
    visited.set(edge.collection, seen);
    const fresh = rows.filter((uuid) => !seen.has(uuid));
    if (fresh.length === 0) continue;
    for (const uuid of fresh) seen.add(uuid);
    await walkCascade(tx, dialect, edge.collection, fresh, doomed, visited);
  }
}

/**
 * The `UUID`s of one table's rows whose `column` references any of `uuids`, chunked for the driver.
 */
async function rowsReferencing(
  tx: Transaction,
  dialect: Dialect,
  table: string,
  column: string,
  uuids: readonly string[],
): Promise<string[]> {
  const rows: string[] = [];
  for (const batch of chunk(uuids, 900)) {
    const marks = batch.map(() => '?').join(', ');
    const found = await tx.query<{ UUID: string }>(
      `SELECT ${dialect.quote('UUID')} FROM ${dialect.quote(table)} ` +
        `WHERE ${dialect.quote(column)} IN (${marks})`,
      [...batch],
    );
    rows.push(...found.map((row) => row.UUID));
  }
  return rows;
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
 * It deletes only companion, locale-scoped, and instance rows, never a main record.
 * No `restrict` reference into the collection can fire, so the terminal declares no foreign-key arm.
 */
export async function runDeleteTranslation(
  collection: string,
  condition: ConditionNode,
  locale: string,
  joinedTx?: Transaction,
): Promise<DeleteOutcome> {
  const meta = queryMetadata(collection);
  const dialect = useDialect();
  const scoped = await scopeCondition(collection, condition, 'delete');
  const outcome = await runWrite<DeleteResult>(
    dialect,
    joinedTx,
    () => false,
    (tx) => attemptDeleteTranslation(tx, meta, dialect, scoped, locale),
    () => undefined,
  );
  if (isUndefined(joinedTx)) {
    await commitEffects({
      collection: collection as CollectionName,
      operation: 'update',
      uuids: outcome.uuids,
    });
  }
  return { deleted: outcome.deleted };
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
): Promise<DeleteResult> {
  const matched = await matchedUUIDs(tx, meta, dialect, condition, locale);
  if (matched.length === 0) return { deleted: 0, uuids: [] };

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
  return { deleted: affected.size, uuids: [...affected] };
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
