import type { Transaction } from '../adapter.ts';
import type { Dialect } from '../dialect.ts';
import type { DerivedOrigin, ForeignKeySchema } from './table-schema.ts';

import { isUndefined, pluralize } from '../../../utils/index.ts';
import { derivedParentName } from '../naming/table-names.ts';

/**
 * What the purge machinery needs to know about one owned live table.
 * The guard builds the list from the classified live schema; the migration executor from its claims.
 */
export interface SweepTable {
  /**
   * The physical table name.
   */
  name: string;

  /**
   * The derivation origin of a junction, child, or blocks-wrapper table; absent on root tables.
   */
  derived?: DerivedOrigin;

  /**
   * The block whose instances the per-type table stores; absent everywhere else.
   */
  block?: string;
}

/**
 * Builds the condition matching rows whose foreign-key value dangles.
 * When the target table arrives this sync it is empty, so every non-NULL value dangles by definition.
 *
 * The purge target cannot wear an alias inside `UPDATE`/`DELETE`, so the outer column is table-qualified.
 * The subquery alias is therefore `_`-prefixed: user identifiers never start with `_`.
 * No table name can capture the outer qualifier the way a table named `Target` would capture `target`.
 */
export function danglingCondition(
  dialect: Dialect,
  table: string,
  foreignKey: ForeignKeySchema,
  targetCreated: boolean,
): string {
  const column = `${dialect.quote(table)}.${dialect.quote(foreignKey.column)}`;
  if (targetCreated) return `${column} IS NOT NULL`;
  return (
    `${column} IS NOT NULL AND NOT EXISTS (` +
    `SELECT 1 FROM ${dialect.quote(foreignKey.targetTable)} AS ${dialect.quote('_target')} ` +
    `WHERE ${dialect.quote('_target')}.${dialect.quote(foreignKey.targetColumn)} = ${column})`
  );
}

/**
 * Builds the `UPDATE` that clears dangling foreign-key values to `NULL`.
 */
export function clearSQL(
  dialect: Dialect,
  table: string,
  foreignKey: ForeignKeySchema,
  targetCreated: boolean,
): string {
  return (
    `UPDATE ${dialect.quote(table)} SET ${dialect.quote(foreignKey.column)} = NULL ` +
    `WHERE ${danglingCondition(dialect, table, foreignKey, targetCreated)}`
  );
}

/**
 * Builds the `DELETE` that removes rows dangling from `foreignKey`.
 */
export function deleteSQL(
  dialect: Dialect,
  table: string,
  foreignKey: ForeignKeySchema,
  targetCreated: boolean,
): string {
  return (
    `DELETE FROM ${dialect.quote(table)} ` +
    `WHERE ${danglingCondition(dialect, table, foreignKey, targetCreated)}`
  );
}

/**
 * One report line for an executed purge: values cleared to `NULL`, or rows deleted.
 */
export function purgedLine(
  table: string,
  foreignKey: ForeignKeySchema,
  count: number,
  cleared: boolean,
): string {
  return cleared
    ? `- \`${count}\` ${pluralize(count, 'value')} of \`${table}.${foreignKey.column}\` cleared, dangling to missing \`${foreignKey.targetTable}\` rows`
    : `- \`${count}\` ${pluralize(count, 'row')} of \`${table}\` deleted, dangling from \`${table}.${foreignKey.column}\` to missing \`${foreignKey.targetTable}\` rows`;
}

/**
 * Sweeps the block instances the doomed rows of one wrapper reference, before those rows disappear.
 *
 * `doomed` selects the dying wrapper rows, its columns qualified by the wrapper's name.
 * Omitted, every row is doomed - the wrapper drops, or stops being a wrapper.
 * A block row is deleted once no other wrapper row references it.
 * Every `tables` wrapper counts as a referrer, the swept wrapper's own surviving rows included.
 * The wrapper link is polymorphic, so this sweep is the one place orphaned block rows are cleaned.
 * Rows a sync never doomed stay the write layer's cleanup to own.
 *
 * Deleting a block row strands the rows hanging off it, so the sweep cascades over the ownership tree.
 * It runs to a fixed point: child and junction rows whose parent died are deleted.
 * A nested wrapper's rows sweep their own block references first, recursively.
 * `tables` is the live owned universe minus what this sync drops; a table outside it never sweeps.
 * Returns one report line per executed deletion.
 */
export async function sweepWrapperRows(
  db: Transaction,
  dialect: Dialect,
  tables: readonly SweepTable[],
  wrapper: string,
  doomed?: string,
): Promise<string[]> {
  const lines: string[] = [];
  let queue = await sweepBlocks(db, dialect, tables, wrapper, doomed, lines);
  while (queue.length > 0) {
    const next: string[] = [];
    for (const parent of queue) {
      for (const child of childrenOf(tables, parent)) {
        const foreignKey: ForeignKeySchema = {
          column: '_parentUUID',
          targetTable: parent,
          targetColumn: 'UUID',
          onDelete: 'cascade',
        };
        const dangling = danglingCondition(dialect, child.name, foreignKey, false);
        if (child.derived?.kind === 'blocksWrapper') {
          next.push(...(await sweepBlocks(db, dialect, tables, child.name, dangling, lines)));
        }
        const { changes } = await db.run(deleteSQL(dialect, child.name, foreignKey, false));
        if (changes === 0) continue;
        lines.push(purgedLine(child.name, foreignKey, changes, false));
        next.push(child.name);
      }
    }
    queue = next;
  }
  return lines;
}

/**
 * Deletes the block rows only the doomed wrapper rows reference, one per-type table at a time.
 * Returns the block tables that lost rows, so the caller can cascade over what hung off them.
 */
async function sweepBlocks(
  db: Transaction,
  dialect: Dialect,
  tables: readonly SweepTable[],
  wrapper: string,
  doomed: string | undefined,
  lines: string[],
): Promise<string[]> {
  const types = await db.query<{ type: string }>(
    `SELECT DISTINCT ${dialect.quote('_blockType')} AS ${dialect.quote('type')} ` +
      `FROM ${dialect.quote(wrapper)}${isUndefined(doomed) ? '' : ` WHERE ${doomed}`}`,
  );
  const affected: string[] = [];
  for (const { type } of types) {
    const blockTable = tables.find((table) => table.block === type);
    if (isUndefined(blockTable)) continue;
    const survivors = tables.filter(
      (table) => table.derived?.kind === 'blocksWrapper' && table.name !== wrapper,
    );
    const conditions = survivors.map((survivor) =>
      unreferencedCondition(dialect, survivor.name, blockTable),
    );
    if (!isUndefined(doomed)) {
      conditions.push(unreferencedCondition(dialect, wrapper, blockTable, doomed));
    }
    const candidates =
      `${dialect.quote(blockTable.name)}.${dialect.quote('UUID')} IN (` +
      `SELECT ${dialect.quote(wrapper)}.${dialect.quote('_blockUUID')} FROM ${dialect.quote(wrapper)} ` +
      `WHERE ${dialect.quote(wrapper)}.${dialect.quote('_blockType')} = '${blockTable.block as string}'` +
      `${isUndefined(doomed) ? '' : ` AND ${doomed}`})`;
    const where = [candidates, ...conditions].join(' AND ');
    const { changes } = await db.run(
      `DELETE FROM ${dialect.quote(blockTable.name)} WHERE ${where}`,
    );
    if (changes === 0) continue;
    lines.push(
      `- \`${changes}\` ${pluralize(changes, 'row')} of \`${blockTable.name}\` deleted, no longer referenced by any blocks field`,
    );
    affected.push(blockTable.name);
  }
  return affected;
}

/**
 * The condition keeping a block row while some row of `wrapper` still references it.
 * `NOT IN` on purpose: SQLite materializes the subquery into an ephemeral index once per delete.
 * A correlated `NOT EXISTS` would rescan the wrapper per row and measured quadratic.
 * Nothing else serves the probe - the wrapper's `_blockUUID` index is down inside the sync bracket.
 * `excludeDoomed` carves the dying rows out of the swept wrapper's own references.
 */
function unreferencedCondition(
  dialect: Dialect,
  wrapper: string,
  blockTable: SweepTable,
  excludeDoomed?: string,
): string {
  const row = dialect.quote(wrapper);
  return (
    `${dialect.quote(blockTable.name)}.${dialect.quote('UUID')} NOT IN (` +
    `SELECT ${row}.${dialect.quote('_blockUUID')} FROM ${row} ` +
    `WHERE ${row}.${dialect.quote('_blockType')} = '${blockTable.block as string}'` +
    `${isUndefined(excludeDoomed) ? '' : ` AND NOT (${excludeDoomed})`})`
  );
}

/**
 * The owned tables whose rows hang off `parent`, one derivation level down.
 */
function childrenOf(tables: readonly SweepTable[], parent: string): SweepTable[] {
  return tables.filter(
    (table) => !isUndefined(table.derived) && derivedParentName(table.derived) === parent,
  );
}
