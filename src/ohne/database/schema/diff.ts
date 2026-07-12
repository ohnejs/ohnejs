import type { Dialect } from '../dialect.ts';
import type {
  ColumnChange,
  ColumnSchema,
  DerivedOrigin,
  TableAlter,
  TableDiff,
  TableSchema,
} from './table-schema.ts';

import { deepEqual, isUndefined, keyBy } from '../../../utils/index.ts';

/**
 * Diffs the live schema against the desired one, per table and per constraint.
 * Output order is the apply order: drops first, then creates, then alters.
 * Column types compare through `dialect.columnType`, so two primitives sharing a native type never differ.
 * Unchanged tables produce nothing.
 *
 * A same-named table whose field changed kind incompatibly is a drop plus a create, never an alter.
 * The old shape's rows cannot morph into the new one, so the whole table is replaced.
 */
export function diffSchemas(
  live: readonly TableSchema[],
  desired: readonly TableSchema[],
  dialect: Dialect,
): TableDiff[] {
  const liveByName = keyBy(live, (table) => table.name);
  const desiredByName = keyBy(desired, (table) => table.name);
  const diffs: TableDiff[] = [];
  for (const table of live) {
    const wanted = desiredByName[table.name];
    if (isUndefined(wanted) || incompatibleReshape(table, wanted))
      diffs.push({ kind: 'drop', table });
  }
  for (const table of desired) {
    const liveTable = liveByName[table.name];
    if (isUndefined(liveTable) || incompatibleReshape(liveTable, table))
      diffs.push({ kind: 'create', table });
  }
  for (const desiredTable of desired) {
    const liveTable = liveByName[desiredTable.name];
    if (isUndefined(liveTable) || incompatibleReshape(liveTable, desiredTable)) continue;
    const alter = diffTable(liveTable, desiredTable, dialect);
    if (!isUndefined(alter)) diffs.push(alter);
  }
  return diffs;
}

/**
 * Whether a derived kind is one of the composite child tables.
 * `childOne` and `childMany` share their core columns, so a change between them alters in place.
 */
function isChildKind(kind: DerivedOrigin['kind'] | undefined): boolean {
  return kind === 'childOne' || kind === 'childMany';
}

/**
 * Whether a column is a structural one the desired builder emits, never a user value.
 * The `UUID` key and every `_`-prefixed internal column; no value can fill these across a reshape.
 */
function isStructuralColumn(name: string): boolean {
  return name === 'UUID' || name.startsWith('_');
}

/**
 * Whether two same-named tables are an incompatible kind reshape that cannot alter in place.
 *
 * A field kept its name but changed kind, and the new shape needs a structural `NOT NULL` column.
 * The live table lacks such a column and no value can fill it.
 * A junction needs `_targetUUID`, a wrapper needs `_blockType`, a child needs `UUID`.
 * Such a change replaces the table, so the diff drops the old and creates the new.
 * A change within the child family (`childOne` <-> `childMany`) alters in place instead.
 * A reshape that only sheds structural columns, a wrapper collapsing into a child, alters too.
 * Both therefore return `false`.
 */
function incompatibleReshape(live: TableSchema, desired: TableSchema): boolean {
  const liveKind = live.derived?.kind;
  const desiredKind = desired.derived?.kind;
  if (liveKind === desiredKind) return false;
  if (isChildKind(liveKind) && isChildKind(desiredKind)) return false;
  const liveColumns = new Set(live.columns.map((column) => column.name));
  return desired.columns.some(
    (column) => column.notNull && isStructuralColumn(column.name) && !liveColumns.has(column.name),
  );
}

/**
 * Diffs one table present on both sides, or `undefined` when nothing differs.
 */
function diffTable(
  live: TableSchema,
  desired: TableSchema,
  dialect: Dialect,
): TableAlter | undefined {
  const liveColumns = keyBy(live.columns, (column) => column.name);
  const desiredColumns = keyBy(desired.columns, (column) => column.name);
  const addColumns = desired.columns.filter((column) => isUndefined(liveColumns[column.name]));
  const dropColumns = live.columns.filter((column) => isUndefined(desiredColumns[column.name]));
  const changeColumns: ColumnChange[] = [];
  for (const column of desired.columns) {
    const liveColumn = liveColumns[column.name];
    if (isUndefined(liveColumn) || sameColumn(liveColumn, column, dialect)) continue;
    changeColumns.push({ live: liveColumn, desired: column });
  }
  const [dropUniques, addUniques] = diffBy(live.uniques, desired.uniques, (unique) => unique.name);
  const [dropIndexes, addIndexes] = diffBy(live.indexes, desired.indexes, (index) => index.name);
  const [dropForeignKeys, addForeignKeys] = diffBy(
    live.foreignKeys,
    desired.foreignKeys,
    (foreignKey) => foreignKey.column,
  );
  const changePrimaryKey = !deepEqual(live.primaryKey, desired.primaryKey);
  const changed =
    addColumns.length > 0 ||
    dropColumns.length > 0 ||
    changeColumns.length > 0 ||
    changePrimaryKey ||
    addUniques.length > 0 ||
    dropUniques.length > 0 ||
    addIndexes.length > 0 ||
    dropIndexes.length > 0 ||
    addForeignKeys.length > 0 ||
    dropForeignKeys.length > 0;
  if (!changed) return undefined;
  return {
    kind: 'alter',
    live,
    desired,
    addColumns,
    dropColumns,
    changeColumns,
    changePrimaryKey,
    addUniques,
    dropUniques,
    addIndexes,
    dropIndexes,
    addForeignKeys,
    dropForeignKeys,
  };
}

/**
 * Whether two columns agree on native column type and nullability.
 */
function sameColumn(live: ColumnSchema, desired: ColumnSchema, dialect: Dialect): boolean {
  return (
    dialect.columnType(live.type) === dialect.columnType(desired.type) &&
    live.notNull === desired.notNull
  );
}

/**
 * A same-key entry with a different definition is a rewrite: the live one drops, the desired one adds.
 */
function diffBy<T>(
  live: readonly T[],
  desired: readonly T[],
  key: (item: T) => string,
): [T[], T[]] {
  const liveByKey = keyBy(live, key);
  const desiredByKey = keyBy(desired, key);
  const drops = live.filter((item) => !deepEqual(item, desiredByKey[key(item)]));
  const adds = desired.filter((item) => !deepEqual(item, liveByKey[key(item)]));
  return [drops, adds];
}
