import type { SQLValue, Transaction } from '../../database/adapter.ts';
import type { Dialect, LogicalType } from '../../database/dialect.ts';
import type { FieldQueryMeta } from '../metadata.ts';
import type { ProcessedRelation, ProcessedScope } from '../pipeline/run-record.ts';

import { chunk, isUndefined, uniqueArray, uuidv7 } from '../../../utils/index.ts';

/**
 * The junction column roles of one `records` field, the owner side by default and swapped on the inverse.
 * `self`/`selfPosition` link and order this scope's row; `link`/`linkPosition` the target's.
 */
export interface JunctionColumns {
  /**
   * The junction table holding the links.
   */
  table: string;

  /**
   * The column linking this scope's row.
   */
  self: string;

  /**
   * The column linking the target row.
   */
  link: string;

  /**
   * The position column ordering the links on this scope's side.
   */
  selfPosition: string;

  /**
   * The position column ordering the links on the target's side.
   */
  linkPosition: string;
}

/**
 * Resolves one `records` field's junction column roles, swapping every role on the inverse side.
 * The owner side links through `_parentUUID`/`_parentPosition`; the inverse reads the same table swapped.
 */
export function junctionColumns(meta: FieldQueryMeta): JunctionColumns {
  const inverse = meta.inverse === true;
  return {
    table: meta.table as string,
    self: inverse ? '_targetUUID' : '_parentUUID',
    link: inverse ? '_parentUUID' : '_targetUUID',
    selfPosition: inverse ? '_targetPosition' : '_parentPosition',
    linkPosition: inverse ? '_parentPosition' : '_targetPosition',
  };
}

/**
 * Maps each column name to its storage primitive, for the bind-time codec.
 */
export function columnTypes(fields: Record<string, FieldQueryMeta>): Map<string, LogicalType> {
  const map = new Map<string, LogicalType>();
  for (const field of Object.values(fields)) {
    if (field.column && field.logicalType) map.set(field.column, field.logicalType);
  }
  return map;
}

/**
 * The next position to append at, per target, one past that target's current maximum in the junction.
 */
export async function appendPositions(
  tx: Transaction,
  dialect: Dialect,
  table: string,
  linkColumn: string,
  linkPosition: string,
  targets: readonly string[],
): Promise<Map<string, number>> {
  const next = new Map<string, number>();
  const column = dialect.quote(linkColumn);
  for (const batch of chunk(uniqueArray(targets), 900)) {
    const marks = batch.map(() => '?').join(', ');
    const rows = await tx.query<{ target: string; max: number | null }>(
      `SELECT ${column} AS "target", MAX(${dialect.quote(linkPosition)}) AS "max" ` +
        `FROM ${dialect.quote(table)} WHERE ${column} IN (${marks}) GROUP BY ${column}`,
      batch,
    );
    for (const row of rows) next.set(row.target, (row.max ?? -1) + 1);
  }
  return next;
}

/**
 * Inserts one `records` field's junction rows, appending each target's position after its existing links.
 * The owner side writes `_parentPosition` in input order; the inverse side swaps every role.
 */
export async function insertJunction(
  tx: Transaction,
  dialect: Dialect,
  relation: ProcessedRelation,
  ownerUUID: string,
): Promise<void> {
  if (relation.uuids.length === 0) return;
  const cols = junctionColumns(relation.meta);
  const nextByTarget = await appendPositions(
    tx,
    dialect,
    cols.table,
    cols.link,
    cols.linkPosition,
    relation.uuids,
  );
  const rows = relation.uuids.map((target, index) => {
    const position = nextByTarget.get(target) ?? 0;
    nextByTarget.set(target, position + 1);
    return [ownerUUID, target, index, position] as SQLValue[];
  });

  const quoted = [cols.self, cols.link, cols.selfPosition, cols.linkPosition]
    .map((column) => dialect.quote(column))
    .join(', ');
  for (const batch of chunk(rows, 225)) {
    const tuples = batch.map(() => '(?, ?, ?, ?)').join(', ');
    await tx.run(
      `INSERT INTO ${dialect.quote(cols.table)} (${quoted}) VALUES ${tuples}`,
      batch.flat(),
    );
  }
}

/**
 * Inserts one scope's main row, then its junction links and child items, recursing into each.
 *
 * A top-level row carries `_updatedAt`; a child row carries `_parentUUID` and, for a repeater, its position.
 * Child items insert with fresh `uuidv7` keys, depth-first, so a nested tree writes in one pass.
 */
export async function insertScope(
  tx: Transaction,
  dialect: Dialect,
  table: string,
  fields: Record<string, FieldQueryMeta>,
  uuid: string,
  scope: ProcessedScope,
  parent?: { uuid: string; position?: number },
): Promise<void> {
  const columns: string[] = ['UUID'];
  const values: SQLValue[] = [uuid];
  if (parent) {
    columns.push('_parentUUID');
    values.push(parent.uuid);
    if (!isUndefined(parent.position)) {
      columns.push('_parentPosition');
      values.push(parent.position);
    }
  } else {
    columns.push('_updatedAt');
    values.push(Date.now());
  }
  const columnType = columnTypes(fields);
  for (const [column, value] of Object.entries(scope.columns)) {
    columns.push(column);
    values.push(dialect.serialize(columnType.get(column) as LogicalType, value));
  }
  const marks = columns.map(() => '?').join(', ');
  const quoted = columns.map((column) => dialect.quote(column)).join(', ');
  await tx.run(`INSERT INTO ${dialect.quote(table)} (${quoted}) VALUES (${marks})`, values);

  for (const relation of scope.relations) await insertJunction(tx, dialect, relation, uuid);

  for (const child of scope.children) {
    const position = child.meta.kind === 'childMany';
    const childTable = child.meta.table as string;
    const childFields = child.meta.subfields as Record<string, FieldQueryMeta>;
    for (let index = 0; index < child.items.length; index++) {
      await insertScope(tx, dialect, childTable, childFields, uuidv7(), child.items[index], {
        uuid,
        position: position ? index : undefined,
      });
    }
  }
}
