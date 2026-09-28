import type { Transaction } from '../../adapter.ts';
import type { Dialect } from '../../dialect.ts';
import type {
  ColumnSchema,
  ForeignKeySchema,
  IndexSchema,
  OnDelete,
  TableSchema,
} from '../../schema/table-schema.ts';

import { isString } from '../../../../utils/index.ts';

interface TableInfoRow {
  name: string;
  type: string;
  notnull: number;
  pk: number;
}

interface IndexListRow {
  name: string;
  unique: number;
  origin: string;
}

interface IndexInfoRow {
  seqno: number;
  name: string | null;
}

interface ForeignKeyRow {
  table: string;
  from: string;
  to: string | null;
  on_delete: string;
}

const ON_DELETE: Partial<Record<string, OnDelete>> = {
  CASCADE: 'cascade',
  'NO ACTION': 'noAction',
  RESTRICT: 'restrict',
  'SET DEFAULT': 'setDefault',
  'SET NULL': 'setNull',
};

/**
 * Lists every table in `sqlite_master`, sorted by name, excluding SQLite's own `sqlite_*` internals.
 */
export async function listTables(db: Transaction): Promise<string[]> {
  const rows = await db.query<{ name: string }>(
    `SELECT "name" FROM "sqlite_master" WHERE "type" = 'table' AND "name" NOT GLOB 'sqlite_*' ORDER BY "name"`,
  );
  return rows.map((row) => row.name);
}

/**
 * Describes a live table through SQLite's pragmas, normalized to a `TableSchema`.
 * Column types map by affinity: `INT` means `integer`, `REAL`/`FLOA`/`DOUB` mean `real`, else `text`.
 * The `INT` test runs first, matching SQLite's own rule order - `FLOATING POINT` is INTEGER affinity.
 * The primary key's autoindex stays out of `uniques`; expression indexes carry no columns and are skipped.
 * Foreign keys come back structural, one entry per referencing column.
 * A `REFERENCES` clause without an explicit column resolves to `UUID`.
 */
export async function describeTable(
  db: Transaction,
  table: string,
  dialect: Dialect,
): Promise<TableSchema> {
  const quoted = dialect.quote(table);
  const columnRows = await db.query<TableInfoRow>(`PRAGMA table_info(${quoted})`);
  const columns: ColumnSchema[] = columnRows.map((row) => {
    const declared = row.type.toUpperCase();
    return {
      name: row.name,
      type: declared.includes('INT')
        ? 'integer'
        : /REAL|FLOA|DOUB/.test(declared)
          ? 'real'
          : 'text',
      notNull: row.notnull === 1,
    };
  });
  const primaryKey = columnRows
    .filter((row) => row.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((row) => row.name);
  const uniques: IndexSchema[] = [];
  const indexes: IndexSchema[] = [];
  for (const index of await db.query<IndexListRow>(`PRAGMA index_list(${quoted})`)) {
    if (index.origin === 'pk') continue;
    const parts = await db.query<IndexInfoRow>(`PRAGMA index_info(${dialect.quote(index.name)})`);
    const names = parts.sort((a, b) => a.seqno - b.seqno).map((part) => part.name);
    if (!names.every(isString)) continue;
    (index.unique === 1 ? uniques : indexes).push({ name: index.name, columns: names });
  }
  const foreignKeys: ForeignKeySchema[] = (
    await db.query<ForeignKeyRow>(`PRAGMA foreign_key_list(${quoted})`)
  ).map((row) => ({
    column: row.from,
    targetTable: row.table,
    targetColumn: row.to ?? 'UUID',
    onDelete: ON_DELETE[row.on_delete] ?? 'noAction',
  }));
  return { name: table, columns, primaryKey, uniques, indexes, foreignKeys };
}
