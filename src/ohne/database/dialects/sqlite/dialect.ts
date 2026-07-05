import { DatabaseSync } from 'node:sqlite';

import type { DatabaseAdapter, SQLValue, Transaction } from '../../adapter.ts';
import type { TableSchema } from '../../schema/table-schema.ts';

import { ensureDir } from '../../../../utils/fs/index.ts';
import { dirname, isNull, isNullish, isNumber, isObject } from '../../../../utils/index.ts';
import { Dialect, type LogicalType } from '../../dialect.ts';
import { describeTable, listTables } from './introspect.ts';
import { applyPragmas } from './pragmas.ts';

// SQLite extended result codes for the constraint violations the engine classifies.
const SQLITE_CONSTRAINT_PRIMARYKEY = 1555;
const SQLITE_CONSTRAINT_UNIQUE = 2067;
const SQLITE_CONSTRAINT_FOREIGNKEY = 787;

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
