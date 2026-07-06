import { DatabaseSync } from 'node:sqlite';

import type { DatabaseAdapter, SQLValue, Transaction } from '../../adapter.ts';
import type { TableAlter, TableDiff, TableSchema } from '../../schema/table-schema.ts';

import { truncateWithHash } from '../../../../utils/crypto/index.ts';
import { ensureDir } from '../../../../utils/fs/index.ts';
import {
  dirname,
  isNull,
  isNullish,
  isNumber,
  isObject,
  isUndefined,
} from '../../../../utils/index.ts';
import { Dialect, type LogicalType } from '../../dialect.ts';
import { OHNE_REBUILD_PREFIX } from '../../naming/table-names.ts';
import { describeTable, listTables } from './introspect.ts';
import { applyPragmas } from './pragmas.ts';
import { createIndex, createIndexes, createTable, rebuildTable, sweepRebuilds } from './rebuild.ts';

// SQLite extended result codes for the constraint violations the engine classifies.
const SQLITE_CONSTRAINT_PRIMARYKEY = 1555;
const SQLITE_CONSTRAINT_UNIQUE = 2067;
const SQLITE_CONSTRAINT_FOREIGNKEY = 787;

// Primary result codes for a database held by another connection.
const SQLITE_BUSY = 5;
const SQLITE_LOCKED = 6;

/**
 * The SQLite dialect, over Node's built-in `node:sqlite`.
 *
 * The only file in ohne that imports a database driver.
 * Everything else speaks `DatabaseAdapter` and `Dialect`.
 * The base `acquireLock`/`releaseLock` carry over unchanged.
 * They run their portable SQL through this dialect's `quote` and `columnType`.
 */
export class SQLiteDialect extends Dialect {
  readonly name = 'sqlite';

  /**
   * Opens the database at `url` (a file path or `:memory:`) and applies the pragma set before returning.
   * A file path's parent directory is created on demand, since SQLite creates the file but not its folder.
   */
  async connect(url: string): Promise<DatabaseAdapter> {
    if (url !== ':memory:' && !url.startsWith('file:')) await ensureDir(dirname(url));
    const db = new DatabaseSync(url);
    applyPragmas(db);
    return createAdapter(db);
  }

  /**
   * Wraps an identifier in double quotes, doubling any embedded quote, per SQLite's identifier syntax.
   */
  quote(identifier: string): string {
    return `"${identifier.replaceAll('"', '""')}"`;
  }

  /**
   * Maps a logical type to a SQLite column type: booleans store as `INTEGER`, JSON as `TEXT`.
   */
  columnType(type: LogicalType): string {
    switch (type) {
      case 'text':
      case 'json':
        return 'TEXT';
      case 'integer':
      case 'boolean':
        return 'INTEGER';
    }
  }

  /**
   * Codes a JS value for storage: booleans become `1`/`0`, JSON is stringified, `null`/`undefined` are `NULL`.
   */
  serialize(type: LogicalType, value: unknown): SQLValue {
    if (isNullish(value)) return null;
    switch (type) {
      case 'boolean':
        return value ? 1 : 0;
      case 'json':
        return JSON.stringify(value);
      default:
        return value as SQLValue;
    }
  }

  /**
   * Inverts `serialize`: a stored `1`/`0` becomes a boolean, stored JSON is parsed, `NULL` stays `null`.
   */
  deserialize(type: LogicalType, value: SQLValue): unknown {
    if (isNull(value)) return null;
    switch (type) {
      case 'boolean':
        return value !== 0;
      case 'json':
        return JSON.parse(value as string);
      default:
        return value;
    }
  }

  /**
   * Lists tables from `sqlite_master`, excluding SQLite's own internals.
   */
  listTables(db: Transaction): Promise<string[]> {
    return listTables(db);
  }

  /**
   * Describes a table through SQLite's pragmas.
   */
  describeTable(db: Transaction, table: string): Promise<TableSchema> {
    return describeTable(db, table, this);
  }

  /**
   * Realizes a per-table diff, deciding internally when SQLite forces a rebuild.
   * Nullable column adds, column drops, and index changes apply in place, drops before adds.
   * Anything `ALTER TABLE` cannot express - retypes, key or foreign-key changes - rebuilds once.
   */
  async applyTableDiff(db: Transaction, diff: TableDiff): Promise<void> {
    if (diff.kind === 'create') {
      await createTable(db, this, diff.table);
      await createIndexes(db, this, diff.table);
      return;
    }
    if (diff.kind === 'drop') {
      await db.exec(`DROP TABLE ${this.quote(diff.table.name)}`);
      return;
    }
    if (needsRebuild(diff)) {
      await rebuildTable(db, this, diff);
      return;
    }
    const table = this.quote(diff.desired.name);
    for (const index of [...diff.dropUniques, ...diff.dropIndexes]) {
      await db.exec(`DROP INDEX ${this.quote(index.name)}`);
    }
    for (const column of diff.dropColumns) {
      await db.exec(`ALTER TABLE ${table} DROP COLUMN ${this.quote(column.name)}`);
    }
    for (const column of diff.addColumns) {
      await db.exec(
        `ALTER TABLE ${table} ADD COLUMN ${this.quote(column.name)} ${this.columnType(column.type)}`,
      );
    }
    for (const unique of diff.addUniques)
      await createIndex(db, this, diff.desired.name, unique, true);
    for (const index of diff.addIndexes)
      await createIndex(db, this, diff.desired.name, index, false);
  }

  /**
   * Renames a table in place.
   * SQLite rewrites other tables' `REFERENCES` clauses to follow, even with `foreign_keys = OFF`.
   * A case-only rename hops through an aside name, since SQLite matches table names case-insensitively.
   * The hop runs inside the sync transaction, so a failure between the two steps rolls back whole.
   */
  async renameTable(db: Transaction, from: string, to: string): Promise<void> {
    if (from !== to && from.toLowerCase() === to.toLowerCase()) {
      const aside = truncateWithHash(`${OHNE_REBUILD_PREFIX}${from}`);
      await db.exec(`ALTER TABLE ${this.quote(from)} RENAME TO ${this.quote(aside)}`);
      await db.exec(`ALTER TABLE ${this.quote(aside)} RENAME TO ${this.quote(to)}`);
      return;
    }
    await db.exec(`ALTER TABLE ${this.quote(from)} RENAME TO ${this.quote(to)}`);
  }

  /**
   * Drops leftover `ohne_rebuild_` aside tables a crashed rebuild left behind.
   */
  sweepRebuilds(db: Transaction): Promise<void> {
    return sweepRebuilds(db, this);
  }

  /**
   * Runs its own `BEGIN`/`COMMIT`/`ROLLBACK` with `foreign_keys = OFF` hoisted outside the transaction.
   * The pragma no-ops inside one, which is why this never delegates to the adapter's `transaction`.
   * `foreign_keys = ON` is restored on both the commit and the rollback path.
   */
  async schemaTransaction<T>(db: DatabaseAdapter, fn: (tx: Transaction) => Promise<T>): Promise<T> {
    await db.exec('PRAGMA foreign_keys = OFF');
    try {
      await db.exec('BEGIN');
      try {
        const result = await fn(db);
        await db.exec('COMMIT');
        return result;
      } catch (error) {
        await db.exec('ROLLBACK');
        throw error;
      }
    } finally {
      await db.exec('PRAGMA foreign_keys = ON');
    }
  }

  /**
   * Classifies a duplicate-key failure, covering both a unique index and a primary key.
   */
  isUniqueViolation(error: unknown): boolean {
    const code = errcodeOf(error);
    return code === SQLITE_CONSTRAINT_UNIQUE || code === SQLITE_CONSTRAINT_PRIMARYKEY;
  }

  /**
   * Classifies a foreign-key failure.
   */
  isForeignKeyViolation(error: unknown): boolean {
    return errcodeOf(error) === SQLITE_CONSTRAINT_FOREIGNKEY;
  }

  /**
   * Classifies a busy or locked database, extended codes folded to their primary result code.
   */
  isBusy(error: unknown): boolean {
    const code = errcodeOf(error);
    if (isUndefined(code)) return false;
    const primary = code & 0xff;
    return primary === SQLITE_BUSY || primary === SQLITE_LOCKED;
  }
}

/**
 * Whether an alter holds anything SQLite's `ALTER TABLE` cannot express in place.
 * A dropped `sqlite_autoindex_` unique is an inline constraint, droppable only by rebuilding.
 */
function needsRebuild(diff: TableAlter): boolean {
  return (
    diff.changeColumns.length > 0 ||
    diff.changePrimaryKey ||
    diff.addForeignKeys.length > 0 ||
    diff.dropForeignKeys.length > 0 ||
    diff.addColumns.some((column) => column.notNull) ||
    [...diff.dropUniques, ...diff.dropIndexes].some((index) =>
      index.name.startsWith('sqlite_autoindex_'),
    )
  );
}

/**
 * Reads the numeric `errcode` a `node:sqlite` error carries, or `undefined` when it is not one.
 */
function errcodeOf(error: unknown): number | undefined {
  if (!isObject(error)) return undefined;
  const code = error['errcode'];
  return isNumber(code) ? code : undefined;
}

/**
 * Wraps a `node:sqlite` connection in the async `DatabaseAdapter` surface.
 * The driver is synchronous, so each method resolves at once.
 * Transactions run `BEGIN`/`COMMIT`/`ROLLBACK` explicitly, since `DatabaseSync` has no transaction helper.
 */
function createAdapter(db: DatabaseSync): DatabaseAdapter {
  const adapter: DatabaseAdapter = {
    async exec(sql) {
      db.exec(sql);
    },
    async run(sql, params = []) {
      const { changes } = db.prepare(sql).run(...params);
      return { changes: Number(changes) };
    },
    async query(sql, params = []) {
      return db.prepare(sql).all(...params) as never;
    },
    async queryOne(sql, params = []) {
      return db.prepare(sql).get(...params) as never;
    },
    async transaction(fn) {
      db.exec('BEGIN');
      try {
        const result = await fn(adapter);
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    async close() {
      db.close();
    },
  };
  return adapter;
}
