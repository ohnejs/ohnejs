import type { Transaction } from '../../adapter.ts';
import type { Dialect } from '../../dialect.ts';
import type { IndexSchema, OnDelete, TableAlter, TableSchema } from '../../schema/table-schema.ts';

import { truncateWithHash } from '../../../../utils/crypto/index.ts';
import { isUndefined, keyBy } from '../../../../utils/index.ts';
import { OHNE_REBUILD_PREFIX } from '../../naming/table-names.ts';

const ON_DELETE_SQL: Record<OnDelete, string> = {
  cascade: 'CASCADE',
  noAction: 'NO ACTION',
  restrict: 'RESTRICT',
  setDefault: 'SET DEFAULT',
  setNull: 'SET NULL',
};

/**
 * Creates `schema`'s table: columns with inline foreign keys, the primary key as a table constraint.
 * Indexes are not created here; `createIndexes` adds them once no other table holds their names.
 */
export async function createTable(
  db: Transaction,
  dialect: Dialect,
  schema: TableSchema,
): Promise<void> {
  const foreignKeys = keyBy(schema.foreignKeys, (foreignKey) => foreignKey.column);
  const parts = schema.columns.map((column) => {
    let sql = `${dialect.quote(column.name)} ${dialect.columnType(column.type)}`;
    if (column.notNull) sql += ' NOT NULL';
    const foreignKey = foreignKeys[column.name];
    if (!isUndefined(foreignKey)) {
      sql += ` REFERENCES ${dialect.quote(foreignKey.targetTable)} (${dialect.quote(foreignKey.targetColumn)})`;
      sql += ` ON DELETE ${ON_DELETE_SQL[foreignKey.onDelete]}`;
    }
    return sql;
  });
  if (schema.primaryKey.length > 0) {
    parts.push(`PRIMARY KEY (${schema.primaryKey.map((name) => dialect.quote(name)).join(', ')})`);
  }
  await db.exec(`CREATE TABLE ${dialect.quote(schema.name)} (${parts.join(', ')})`);
}

/**
 * Creates one index on `table`, a unique index when `unique` is set.
 */
export async function createIndex(
  db: Transaction,
  dialect: Dialect,
  table: string,
  index: IndexSchema,
  unique: boolean,
): Promise<void> {
  const columns = index.columns.map((name) => dialect.quote(name)).join(', ');
  await db.exec(
    `CREATE ${unique ? 'UNIQUE ' : ''}INDEX ${dialect.quote(index.name)} ON ${dialect.quote(table)} (${columns})`,
  );
}

/**
 * Creates every unique and index of `schema`, uniques always as separate unique indexes.
 * An inline `UNIQUE` table constraint would be undroppable without a rebuild, so none ever exists.
 */
export async function createIndexes(
  db: Transaction,
  dialect: Dialect,
  schema: TableSchema,
): Promise<void> {
  for (const unique of schema.uniques) await createIndex(db, dialect, schema.name, unique, true);
  for (const index of schema.indexes) await createIndex(db, dialect, schema.name, index, false);
}

/**
 * Rebuilds one table into its desired shape: create aside, copy, drop the old, rename into place, re-index.
 * N column changes cost this one pass.
 * A retyped column is excluded from the copy - SQLite affinity would carry old values into the new type.
 * SQLite rewrites `REFERENCES` clauses naming a renamed table, even with `foreign_keys = OFF`.
 * The new table builds under the aside name so the final rename touches a name nobody references.
 * Indexes are created after the old table drops, since it holds the index names until then.
 */
export async function rebuildTable(
  db: Transaction,
  dialect: Dialect,
  alter: TableAlter,
): Promise<void> {
  const aside = truncateWithHash(`${OHNE_REBUILD_PREFIX}${alter.live.name}`);
  await createTable(db, dialect, { ...alter.desired, name: aside });
  const retyped = new Set(
    alter.changeColumns
      .filter(
        (change) =>
          dialect.columnType(change.live.type) !== dialect.columnType(change.desired.type),
      )
      .map((change) => change.desired.name),
  );
  const liveNames = new Set(alter.live.columns.map((column) => column.name));
  const copyColumns = alter.desired.columns
    .map((column) => column.name)
    .filter((name) => liveNames.has(name) && !retyped.has(name));
  if (copyColumns.length > 0) {
    const list = copyColumns.map((name) => dialect.quote(name)).join(', ');
    await db.exec(
      `INSERT INTO ${dialect.quote(aside)} (${list}) SELECT ${list} FROM ${dialect.quote(alter.live.name)}`,
    );
  }
  await db.exec(`DROP TABLE ${dialect.quote(alter.live.name)}`);
  await db.exec(
    `ALTER TABLE ${dialect.quote(aside)} RENAME TO ${dialect.quote(alter.desired.name)}`,
  );
  await createIndexes(db, dialect, alter.desired);
}

/**
 * Drops every leftover `ohne_rebuild_` aside table a crashed rebuild left behind.
 * The prefix matches in JS, never via SQL `LIKE`.
 * `LIKE` reads `_` as a wildcard and ignores ASCII case, so it could match a foreign table.
 */
export async function sweepRebuilds(db: Transaction, dialect: Dialect): Promise<void> {
  const rows = await db.query<{ name: string }>(
    `SELECT "name" FROM "sqlite_master" WHERE "type" = 'table'`,
  );
  for (const row of rows) {
    if (!row.name.startsWith(OHNE_REBUILD_PREFIX)) continue;
    await db.exec(`DROP TABLE ${dialect.quote(row.name)}`);
  }
}
