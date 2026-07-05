import type { DatabaseAdapter, SQLValue, Transaction } from './adapter.ts';

import { randomToken } from '../../utils/crypto/index.ts';
import { OHNE_LOCKS } from './naming/table-names.ts';

/**
 * The storage-primitive column types the schema model reconciles.
 * A dialect maps each to a native type with `columnType` and codes values with `serialize`/`deserialize`.
 * The set is closed: a new field type composes these primitives, it never adds a fifth.
 *
 * `integer` is 64-bit, so a dialect maps it to a wide column such as Postgres `bigint`, never `int4`.
 * Epoch-ms timestamps and large counts then fit without overflow; SQLite's `INTEGER` is already 64-bit.
 * No float primitive: money is `integer` minor units, a decimal is `text` coded by its field type.
 */
export type LogicalType = 'text' | 'integer' | 'boolean' | 'json';

/**
 * A held cluster lock, returned by `acquireLock` and surrendered to `releaseLock`.
 */
export interface LockHandle {
  /**
   * The key the lock was acquired under.
   */
  key: string;

  /**
   * The random nonce identifying this holder, matched on release so only the winner can free the lock.
   */
  nonce: string;
}

/**
 * A database dialect: the single place a driver and its SQL live.
 *
 * The engine speaks intent - logical types, quoted identifiers, a per-table diff.
 * The dialect turns that into the driver's SQL; nothing outside a dialect imports a driver or branches on one.
 * Abstract members are the completeness contract: a dialect that cannot satisfy one cannot compile.
 * Later phases add more members, so every dialect layer gets a compile error rather than a runtime surprise.
 *
 * Register an instance under a name with `useDialects`; `database.dialect` selects it.
 * The base `acquireLock`/`releaseLock` implement a portable cluster lock over an `ohne_locks` table.
 * A dialect with a native lock, like Postgres advisory locks, overrides them.
 */
export abstract class Dialect {
  /**
   * The name this dialect registers under, matched by `database.dialect`.
   */
  abstract readonly name: string;

  /**
   * Opens a connection to `url` and returns a tuned adapter.
   * The one place a driver is instantiated; the returned adapter already has the dialect's pragmas applied.
   *
   * @example
   * ```ts
   * const db = await dialect.connect(':memory:')
   * ```
   */
  abstract connect(url: string): Promise<DatabaseAdapter>;

  /**
   * Quotes an identifier - a table or column name - for safe interpolation into SQL.
   *
   * @example
   * ```ts
   * dialect.quote('Posts') // -> '"Posts"'
   * ```
   */
  abstract quote(identifier: string): string;

  /**
   * Maps a logical type to the native column type used in `CREATE TABLE`.
   *
   * @example
   * ```ts
   * dialect.columnType('integer') // -> 'INTEGER'
   * ```
   */
  abstract columnType(type: LogicalType): string;

  /**
   * Converts a JS value of `type` into a driver-ready `SQLValue`.
   * Booleans and JSON never reach the adapter raw; this is where they become storable primitives.
   *
   * @example
   * ```ts
   * dialect.serialize('boolean', true) // -> 1
   * ```
   */
  abstract serialize(type: LogicalType, value: unknown): SQLValue;

  /**
   * Converts a stored `SQLValue` of `type` back into its JS value, inverting `serialize`.
   *
   * @example
   * ```ts
   * dialect.deserialize('boolean', 1) // -> true
   * ```
   */
  abstract deserialize(type: LogicalType, value: SQLValue): unknown;

  /**
   * Whether `error` thrown by the driver is a unique-constraint violation.
   *
   * @example
   * ```ts
   * dialect.isUniqueViolation(caught)
   * // -> true when a unique or primary-key constraint failed
   * ```
   */
  abstract isUniqueViolation(error: unknown): boolean;

  /**
   * Whether `error` thrown by the driver is a foreign-key-constraint violation.
   *
   * @example
   * ```ts
   * dialect.isForeignKeyViolation(caught)
   * // -> true when a foreign-key constraint failed
   * ```
   */
  abstract isForeignKeyViolation(error: unknown): boolean;

  /**
   * Races for the cluster lock `key` by inserting a nonce row into `ohne_locks`.
   * Ensures the table first, then inserts with `ON CONFLICT DO NOTHING`.
   * The winner's insert changes one row and yields a handle; a contender that changed nothing gets `null`.
   * Runs on the raw adapter, outside any transaction, because the lock is taken before a sync begins.
   *
   * @example
   * ```ts
   * const handle = await dialect.acquireLock(db, 'sync')
   * // -> a LockHandle, or null if held
   * ```
   */
  async acquireLock(db: DatabaseAdapter, key: string): Promise<LockHandle | null> {
    const table = this.quote(OHNE_LOCKS);
    await db.exec(
      `CREATE TABLE IF NOT EXISTS ${table} (` +
        `${this.quote('key')} ${this.columnType('text')} PRIMARY KEY, ` +
        `${this.quote('nonce')} ${this.columnType('text')} NOT NULL, ` +
        `${this.quote('acquiredAt')} ${this.columnType('integer')} NOT NULL)`,
    );
    const nonce = randomToken();
    const { changes } = await db.run(
      `INSERT INTO ${table} (${this.quote('key')}, ${this.quote('nonce')}, ${this.quote('acquiredAt')}) ` +
        `VALUES (?, ?, ?) ON CONFLICT (${this.quote('key')}) DO NOTHING`,
      [key, nonce, Date.now()],
    );
    return changes === 1 ? { key, nonce } : null;
  }

  /**
   * Releases a held lock by deleting its row, matched on both key and nonce.
   * Takes a `Transaction` so a sync can free the cluster as its final statement, released atomically by COMMIT.
   * A nonce mismatch (another holder took over) deletes nothing, so a stale holder cannot free a live lock.
   *
   * @example
   * ```ts
   * await dialect.releaseLock(tx, handle)
   * ```
   */
  async releaseLock(tx: Transaction, handle: LockHandle): Promise<void> {
    await tx.run(
      `DELETE FROM ${this.quote(OHNE_LOCKS)} ` +
        `WHERE ${this.quote('key')} = ? AND ${this.quote('nonce')} = ?`,
      [handle.key, handle.nonce],
    );
  }
}
