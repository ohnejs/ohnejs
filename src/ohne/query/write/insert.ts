import type { SQLValue, Transaction } from '../../database/adapter.ts';
import type { Dialect, LogicalType } from '../../database/dialect.ts';
import type { CollectionQueryMeta, FieldQueryMeta } from '../metadata.ts';
import type { ProcessedChild, ProcessedRelation, ProcessedScope } from '../pipeline/run-record.ts';

import { chunk, isNull, isUndefined, uniqueArray, uuidv7 } from '../../../utils/index.ts';
import { blockQueryMetadata } from '../metadata.ts';

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
 * Splits a processed scope's columns by home: the main table's, and the companion's per-locale ones.
 * A collection with no translatable column puts everything in `main` and an empty `companion`.
 */
export function splitColumns(
  fields: Record<string, FieldQueryMeta>,
  columns: Record<string, unknown>,
): { main: Record<string, unknown>; companion: Record<string, unknown> } {
  const main: Record<string, unknown> = {};
  const companion: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(columns)) {
    const home = fields[column]?.companion === true ? companion : main;
    home[column] = value;
  }
  return { main, companion };
}

/**
 * Inserts one record's companion row at `locale`, carrying its translatable column values.
 * The parent row and its `_updatedAt` are the caller's; the companion has no timestamp of its own.
 */
export async function insertCompanion(
  tx: Transaction,
  dialect: Dialect,
  meta: CollectionQueryMeta,
  parentUUID: string,
  columns: Record<string, unknown>,
  locale: string,
): Promise<void> {
  const columnType = columnTypes(meta.fields);
  const names: string[] = ['_parentUUID', '_localeCode'];
  const values: SQLValue[] = [parentUUID, locale];
  for (const [column, value] of Object.entries(columns)) {
    names.push(column);
    values.push(dialect.serialize(columnType.get(column) as LogicalType, value));
  }
  const marks = names.map(() => '?').join(', ');
  const quoted = names.map((name) => dialect.quote(name)).join(', ');
  await tx.run(
    `INSERT INTO ${dialect.quote(meta.companionTable as string)} (${quoted}) VALUES (${marks})`,
    values,
  );
}

/**
 * The next position to append at, per target, one past that target's current maximum in the junction.
 * A locale-scoped junction orders per (target, locale), so `locale` narrows the maximum it counts from.
 */
export async function appendPositions(
  tx: Transaction,
  dialect: Dialect,
  table: string,
  linkColumn: string,
  linkPosition: string,
  targets: readonly string[],
  locale: string | null,
): Promise<Map<string, number>> {
  const next = new Map<string, number>();
  const column = dialect.quote(linkColumn);
  const filter = isNull(locale) ? '' : ` AND ${dialect.quote('_localeCode')} = ?`;
  for (const batch of chunk(uniqueArray(targets), 900)) {
    const marks = batch.map(() => '?').join(', ');
    const rows = await tx.query<{ target: string; max: number | null }>(
      `SELECT ${column} AS "target", MAX(${dialect.quote(linkPosition)}) AS "max" ` +
        `FROM ${dialect.quote(table)} WHERE ${column} IN (${marks})${filter} GROUP BY ${column}`,
      isNull(locale) ? batch : [...batch, locale],
    );
    for (const row of rows) next.set(row.target, (row.max ?? -1) + 1);
  }
  return next;
}

/**
 * Inserts one `records` field's junction rows, appending each target's position after its existing links.
 * The owner side writes `_parentPosition` in input order; the inverse side swaps every role.
 * A locale-scoped junction stamps each row's `_localeCode`, so the links belong to one locale.
 */
export async function insertJunction(
  tx: Transaction,
  dialect: Dialect,
  relation: ProcessedRelation,
  ownerUUID: string,
  locale: string,
): Promise<void> {
  if (relation.uuids.length === 0) return;
  const cols = junctionColumns(relation.meta);
  const scoped = relation.meta.localeScoped === true;
  const nextByTarget = await appendPositions(
    tx,
    dialect,
    cols.table,
    cols.link,
    cols.linkPosition,
    relation.uuids,
    scoped ? locale : null,
  );
  const rows = relation.uuids.map((target, index) => {
    const position = nextByTarget.get(target) ?? 0;
    nextByTarget.set(target, position + 1);
    const row: SQLValue[] = [ownerUUID, target, index, position];
    if (scoped) row.push(locale);
    return row;
  });

  const columns = [cols.self, cols.link, cols.selfPosition, cols.linkPosition];
  if (scoped) columns.push('_localeCode');
  const quoted = columns.map((column) => dialect.quote(column)).join(', ');
  const width = Math.floor(900 / columns.length);
  for (const batch of chunk(rows, width)) {
    const tuples = batch.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ');
    await tx.run(
      `INSERT INTO ${dialect.quote(cols.table)} (${quoted}) VALUES ${tuples}`,
      batch.flat(),
    );
  }
}

/**
 * Inserts one scope's main row, then its junction links and child items, recursing into each.
 *
 * Three row modes, keyed on `parent`. Omitted, the row is top-level and carries `_updatedAt`.
 * Given, the row is a child: it carries `_parentUUID`, and `_localeCode` when locale-scoped.
 * A repeater child carries its position too.
 * `'block'` marks a block instance row: a per-type table has no parent link and no timestamp.
 * The wrapper row the caller writes holds the placement.
 * Companion columns are not this insert's: the caller splits them out and writes the companion row.
 * Child items insert with fresh `uuidv7` keys, depth-first, so a nested tree writes in one pass.
 */
export async function insertScope(
  tx: Transaction,
  dialect: Dialect,
  table: string,
  fields: Record<string, FieldQueryMeta>,
  uuid: string,
  scope: ProcessedScope,
  locale: string,
  parent?: { uuid: string; position?: number; scoped?: boolean } | 'block',
): Promise<void> {
  const columns: string[] = ['UUID'];
  const values: SQLValue[] = [uuid];
  if (isUndefined(parent)) {
    columns.push('_updatedAt');
    values.push(Date.now());
  } else if (parent !== 'block') {
    columns.push('_parentUUID');
    values.push(parent.uuid);
    if (parent.scoped === true) {
      columns.push('_localeCode');
      values.push(locale);
    }
    if (!isUndefined(parent.position)) {
      columns.push('_parentPosition');
      values.push(parent.position);
    }
  }
  const columnType = columnTypes(fields);
  for (const [column, value] of Object.entries(scope.columns)) {
    columns.push(column);
    values.push(dialect.serialize(columnType.get(column) as LogicalType, value));
  }
  const marks = columns.map(() => '?').join(', ');
  const quoted = columns.map((column) => dialect.quote(column)).join(', ');
  await tx.run(`INSERT INTO ${dialect.quote(table)} (${quoted}) VALUES (${marks})`, values);

  for (const relation of scope.relations) {
    await insertJunction(tx, dialect, relation, uuid, locale);
  }

  for (const child of scope.children) {
    if (child.meta.kind === 'blocks') {
      await insertBlocks(tx, dialect, child, uuid, locale);
      continue;
    }
    const position = child.meta.kind === 'childMany';
    const childTable = child.meta.table as string;
    const childFields = child.meta.subfields as Record<string, FieldQueryMeta>;
    for (let index = 0; index < child.items.length; index++) {
      await insertScope(
        tx,
        dialect,
        childTable,
        childFields,
        uuidv7(),
        child.items[index],
        locale,
        {
          uuid,
          position: position ? index : undefined,
          scoped: child.meta.localeScoped === true,
        },
      );
    }
  }
}

/**
 * Inserts one blocks field's items: each instance row into its per-type table, then the wrapper rows.
 *
 * Every item gets a fresh instance `uuidv7`, inserted depth-first through `insertScope`'s block mode.
 * Junctions, child tables, and further blocks hang off the instance.
 * The wrapper rows then land in one multi-row `VALUES` per chunk, placing each instance under the owner.
 * `_parentPosition` is the input index, `_blockUUID` the instance.
 * `_localeCode` is stamped when the field is locale-scoped, exactly as a locale-scoped child row is.
 */
async function insertBlocks(
  tx: Transaction,
  dialect: Dialect,
  child: ProcessedChild,
  ownerUUID: string,
  locale: string,
): Promise<void> {
  if (child.items.length === 0) return;
  const instances: string[] = [];
  for (const item of child.items) {
    const instance = uuidv7();
    const blockMeta = blockQueryMetadata(item.blockType as string);
    await insertScope(
      tx,
      dialect,
      blockMeta.table,
      blockMeta.fields,
      instance,
      item,
      locale,
      'block',
    );
    instances.push(instance);
  }

  const scoped = child.meta.localeScoped === true;
  const columns = ['UUID', '_parentUUID', '_parentPosition', '_blockType', '_blockUUID'];
  if (scoped) columns.push('_localeCode');
  const rows = child.items.map((item, index) => {
    const row: SQLValue[] = [
      uuidv7(),
      ownerUUID,
      index,
      item.blockType as string,
      instances[index],
    ];
    if (scoped) row.push(locale);
    return row;
  });
  const quoted = columns.map((column) => dialect.quote(column)).join(', ');
  const width = Math.floor(900 / columns.length);
  for (const batch of chunk(rows, width)) {
    const tuples = batch.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ');
    await tx.run(
      `INSERT INTO ${dialect.quote(child.meta.table as string)} (${quoted}) VALUES ${tuples}`,
      batch.flat(),
    );
  }
}
