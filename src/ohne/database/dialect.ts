import type { RateLimitRate } from '../../utils/index.ts';
import type { DatabaseAdapter, SQLValue, Transaction } from './adapter.ts';
import type { DialectName } from './known-dialects.ts';
import type { TableDiff, TableSchema } from './schema/table-schema.ts';

import { randomToken } from '../../utils/crypto/index.ts';
import { isUndefined, sleep } from '../../utils/index.ts';
import { OHNE_LOCKS, OHNE_RATE_LIMITS } from './naming/table-names.ts';

/**
 * The storage-primitive column types the schema model reconciles.
 * A dialect maps each to a native type with `columnType` and codes values with `serialize`/`deserialize`.
 * The set is closed over what engines natively hold: text, 64-bit integers, and IEEE 754 doubles.
 * `boolean` and `json` are codings over those; a field type composes members, it never adds one.
 *
 * `integer` is 64-bit, so a dialect maps it to a wide column such as Postgres `bigint`, never `int4`.
 * Epoch-ms timestamps and large counts then fit without overflow; SQLite's `INTEGER` is already 64-bit.
 * `real` is IEEE 754 binary64, the double a JS number already is; only finite values pass its gate.
 * A real `-0` stores as `0`; every other accepted value round-trips bit-exact on SQLite and Postgres.
 * No decimal primitive: money is `integer` minor units; an exact decimal stores as `text`, unordered.
 */
export type LogicalType = 'text' | 'integer' | 'real' | 'boolean' | 'json';

/**
 * A list-membership operator over a `json` list column.
 */
export type ListMembershipOperator = 'includes' | 'includesAll' | 'includesAny';

/**
 * A SQL expression with its bound parameters, the shape a dialect hands the compiler.
 */
export interface DialectFragment {
  /**
   * The expression, one `?` per bound parameter.
   */
  sql: string;

  /**
   * The values bound in order.
   */
  params: SQLValue[];
}

/**
 * The table and columns a unique-constraint violation names, parsed from the driver's error.
 */
export interface UniqueViolationTarget {
  /**
   * The table whose unique index failed.
   */
  table: string;

  /**
   * The violated index's columns, in the order the driver names them.
   */
  columns: readonly string[];
}

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
 * Resolved timing for waiting on a held cluster lock.
 */
export interface LockTiming {
  /**
   * Milliseconds between checks of a held lock.
   */
  pollInterval: number;

  /**
   * Milliseconds without a renewal after which a held lock counts as abandoned and may be taken over.
   */
  staleAfter: number;
}

/**
 * Options for `schemaTransaction`.
 */
export interface SchemaTransactionOptions {
  /**
   * Commits on success when `true`; rolls back on success too when `false`, still returning the result.
   * A `false` run is a rehearsal: every statement executes against live data, then the whole unwinds.
   *
   * @default
   * true
   */
  commit?: boolean;
}

const lockTables = new WeakSet<DatabaseAdapter>();

const rateLimitTables = new WeakSet<DatabaseAdapter>();

/**
 * A database dialect: the single place a driver and its SQL live.
 *
 * The engine speaks intent - logical types, quoted identifiers, a per-table diff.
 * The dialect turns that into SQL; nothing outside a dialect imports a driver or branches on one.
 * Abstract members are the completeness contract: a dialect that cannot satisfy one cannot compile.
 *
 * Register an instance under a name with `useDialects`; `database.dialect` selects it.
 * The base lock methods implement a portable cluster lock over an `ohne_locks` table, renewed while held.
 * A dialect with a native lock, like Postgres advisory locks, overrides each of them.
 * The base rate-limit methods count hits in an `ohne_rate_limits` table, one atomic upsert per hit.
 */
export abstract class Dialect {
  /**
   * The name this dialect registers under, matched by `database.dialect`.
   */
  abstract readonly name: DialectName;

  /**
   * The most bound parameters the driver accepts in one statement, its hard variable-count wall.
   * The wire's `maxBoundParams` guard clamps to this, so an untrusted query never reaches the wall.
   */
  abstract readonly maxParameters: number;

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
   * The dialect's case-insensitive text-match expression over an already-quoted column.
   * Holds exactly one `?` placeholder.
   * The caller binds a pattern whose literal parts went through `escapeLike`.
   * Backslash is the escape character.
   * Backs `contains`/`startsWith`/`endsWith` - case-insensitivity is their cross-dialect contract.
   *
   * @example
   * ```ts
   * dialect.textMatch('"title"')
   * // -> `"title" LIKE ? ESCAPE '\'` on SQLite
   * ```
   */
  abstract textMatch(quotedColumn: string): string;

  /**
   * The dialect's list-membership match over an already-quoted `json` list column.
   * Backs `includes`, `includesAll`, and `includesAny` on a `jsonList` field.
   * Returns the positive probe; the compiler guards the column non-`NULL` and negates outside it.
   * A `NULL` list therefore matches nothing, negated or not.
   * Duplicate probe values may deduplicate, so the parameter count never exceeds one per element.
   * An empty `includesAll` matches every row, an empty `includesAny` none.
   *
   * @example
   * ```ts
   * dialect.listMembership('"labels"', 'includes', ['urgent'])
   * // -> { sql: 'EXISTS (SELECT 1 FROM json_each("labels") ...)', params: ['urgent'] } on SQLite
   * ```
   */
  abstract listMembership(
    quotedColumn: string,
    op: ListMembershipOperator,
    values: readonly unknown[],
  ): DialectFragment;

  /**
   * Lists every table in the database, framework and app alike.
   * Driver internals, like SQLite's `sqlite_*` tables, are excluded.
   *
   * @example
   * ```ts
   * await dialect.listTables(db) // -> ['Posts', 'ohne_locks']
   * ```
   */
  abstract listTables(db: Transaction): Promise<string[]>;

  /**
   * Describes one live table as a normalized `TableSchema`.
   * Structure only: column types map to their storage primitive, so `boolean` reads back as `integer`.
   *
   * @example
   * ```ts
   * (await dialect.describeTable(db, 'Posts')).primaryKey // -> ['UUID']
   * ```
   */
  abstract describeTable(db: Transaction, table: string): Promise<TableSchema>;

  /**
   * Realizes one table's whole diff - create, drop, or alter - in however many statements it takes.
   * N column changes on one table cost one pass; on SQLite that one pass may be a full table rebuild.
   * Runs inside the caller's `schemaTransaction` and never opens its own.
   *
   * @example
   * ```ts
   * await dialect.applyTableDiff(tx, { kind: 'drop', table: legacy })
   * ```
   */
  abstract applyTableDiff(db: Transaction, diff: TableDiff): Promise<void>;

  /**
   * Renames a live table, keeping its rows, columns, and foreign keys.
   * Other tables' foreign keys follow the new name; index names stay as they are.
   * Constraint names derive from the table name, so the sync's diff recreates them afterwards.
   *
   * @example
   * ```ts
   * await dialect.renameTable(tx, 'Posts', 'Articles')
   * ```
   */
  abstract renameTable(db: Transaction, from: string, to: string): Promise<void>;

  /**
   * Drops whatever a crashed schema change left behind, called before a sync introspects.
   * The base implementation has nothing to sweep.
   * A dialect that rebuilds tables through aside names overrides this to drop abandoned ones.
   */
  async sweepRebuilds(db: Transaction): Promise<void> {
    void db;
  }

  /**
   * Runs `fn` inside a transaction that is all-or-nothing, DDL included.
   * A failure rolls back every statement, schema changes among them, and re-throws.
   * A dialect over a database with non-transactional DDL must journal its own undo to honor this.
   *
   * With `options.commit` false the success path rolls back as well, still returning `fn`'s result.
   *
   * @example
   * ```ts
   * await dialect.schemaTransaction(db, (tx) => tx.exec('DROP TABLE "legacy"'))
   * ```
   */
  abstract schemaTransaction<T>(
    db: DatabaseAdapter,
    fn: (tx: Transaction) => Promise<T>,
    options?: SchemaTransactionOptions,
  ): Promise<T>;

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
   * The table and columns a unique violation names, or `null` when the message does not parse.
   * Best-effort: the write layer maps the target back to a field, falling back to a blanket error.
   *
   * @example
   * ```ts
   * dialect.uniqueViolationTarget(caught)
   * // -> { table: 'Posts', columns: ['slug'] }
   * ```
   */
  abstract uniqueViolationTarget(error: unknown): UniqueViolationTarget | null;

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
   * Whether `error` is the driver reporting the database temporarily locked by another connection.
   *
   * @example
   * ```ts
   * dialect.isBusy(caught)
   * // -> true when the write lock stayed held past the busy budget
   * ```
   */
  abstract isBusy(error: unknown): boolean;

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
    await this.ensureLockTable(db);
    const nonce = randomToken();
    const { changes } = await db.run(
      `INSERT INTO ${table} (${this.quote('key')}, ${this.quote('nonce')}, ${this.quote('acquiredAt')}) ` +
        `VALUES (?, ?, ?) ON CONFLICT (${this.quote('key')}) DO NOTHING`,
      [key, nonce, Date.now()],
    );
    return changes === 1 ? { key, nonce } : null;
  }

  /**
   * Marks the lock `handle` holds as alive, moving its `acquiredAt` to now, so no waiter takes it over.
   * A lock another holder took over is left alone, since the nonce no longer matches.
   *
   * @example
   * ```ts
   * await dialect.renewLock(db, handle)
   * ```
   */
  async renewLock(db: DatabaseAdapter, handle: LockHandle): Promise<void> {
    await db.run(
      `UPDATE ${this.quote(OHNE_LOCKS)} SET ${this.quote('acquiredAt')} = ? ` +
        `WHERE ${this.quote('key')} = ? AND ${this.quote('nonce')} = ?`,
      [Date.now(), handle.key, handle.nonce],
    );
  }

  /**
   * Waits while another holder keeps `key`, resolving when a new acquisition attempt is worthwhile.
   * The base implementation polls, freeing an abandoned lock through `releaseAbandonedLock`.
   * A dialect with a natively blocking lock overrides this together with every other lock method.
   *
   * @example
   * ```ts
   * await dialect.waitForLock(db, 'sync', { pollInterval: 250, staleAfter: 60_000 })
   * ```
   */
  async waitForLock(db: DatabaseAdapter, key: string, timing: LockTiming): Promise<void> {
    await this.ensureLockTable(db);
    while (!(await this.releaseAbandonedLock(db, key, timing.staleAfter))) {
      await sleep(timing.pollInterval);
    }
  }

  /**
   * Deletes the lock `key` once it went `staleAfter` without a renewal, resolving whether `key` is free.
   * A key nobody holds is free, and one a live holder renewed is not.
   * The delete matches key, nonce, and timestamp, so a renewal or a rival's takeover in between wins.
   * Expects the lock table, which `acquireLock` and `waitForLock` ensure.
   *
   * @example
   * ```ts
   * await dialect.releaseAbandonedLock(db, 'sync', 60_000)
   * // -> true once the key is free
   * ```
   */
  async releaseAbandonedLock(
    db: DatabaseAdapter,
    key: string,
    staleAfter: number,
  ): Promise<boolean> {
    const row = await db.queryOne<{ nonce: string; acquiredAt: number }>(
      `SELECT ${this.quote('nonce')}, ${this.quote('acquiredAt')} ` +
        `FROM ${this.quote(OHNE_LOCKS)} WHERE ${this.quote('key')} = ?`,
      [key],
    );
    if (isUndefined(row)) return true;
    if (Date.now() - row.acquiredAt <= staleAfter) return false;
    const { changes } = await db.run(
      `DELETE FROM ${this.quote(OHNE_LOCKS)} WHERE ${this.quote('key')} = ? ` +
        `AND ${this.quote('nonce')} = ? AND ${this.quote('acquiredAt')} = ?`,
      [key, row.nonce, row.acquiredAt],
    );
    return changes === 1;
  }

  /**
   * Ensures the `ohne_locks` table exists, tolerating a concurrent create.
   * Both the race and the wait ensure it, since a busy-classified lost race can poll first.
   * It runs once per adapter, since DDL on every bid would flush a driver's statement cache.
   */
  protected async ensureLockTable(db: DatabaseAdapter): Promise<void> {
    if (lockTables.has(db)) return;
    await db.exec(
      `CREATE TABLE IF NOT EXISTS ${this.quote(OHNE_LOCKS)} (` +
        `${this.quote('key')} ${this.columnType('text')} PRIMARY KEY, ` +
        `${this.quote('nonce')} ${this.columnType('text')} NOT NULL, ` +
        `${this.quote('acquiredAt')} ${this.columnType('integer')} NOT NULL)`,
    );
    lockTables.add(db);
  }

  /**
   * Releases a held lock by deleting its row, matched on both key and nonce.
   * Takes a `Transaction` so a sync can free the lock as its final statement, released atomically by COMMIT.
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

  /**
   * Counts one hit against `key` at `now`, deciding and counting in one atomic upsert.
   * Resolves `0` when it is allowed, else the milliseconds until the next hit is, counting nothing.
   * A key last taken at a different rate starts over with its full budget.
   *
   * @example
   * ```ts
   * await dialect.takeRateLimit(db, 'login', { limit: 10, window: 60_000 }, Date.now()) // -> 0
   * ```
   */
  async takeRateLimit(
    db: DatabaseAdapter,
    key: string,
    rate: RateLimitRate,
    now: number,
  ): Promise<number> {
    await this.ensureRateLimitTable(db);
    const table = this.quote(OHNE_RATE_LIMITS);
    const [limit, window, at, debt, wait] = ['limit', 'window', 'at', 'debt', 'wait'].map(
      (column) => this.quote(column),
    );
    const int = `CAST(? AS ${this.columnType('integer')})`;
    const old = (column: string): string => `${table}.${column}`;
    const next = (column: string): string => `excluded.${column}`;
    const fresh = `${old(limit)} <> ${next(limit)} OR ${old(window)} <> ${next(window)}`;
    const drained = `${old(debt)} - (${next(at)} - ${old(at)}) * ${next(limit)}`;
    const held =
      `CASE WHEN ${fresh} OR ${next(at)} - ${old(at)} >= ${next(window)} THEN 0 ` +
      `WHEN ${next(at)} <= ${old(at)} THEN ${old(debt)} ` +
      `WHEN ${drained} > 0 THEN ${drained} ELSE 0 END`;
    const due = `(${held}) + ${next(window)}`;
    const capacity = `${next(limit)} * ${next(window)}`;
    const allowed = `${due} <= ${capacity}`;
    // Integer division rounds down, so adding `limit - 1` first rounds the wait up.
    const refill = `(${due} - ${capacity} + ${next(limit)} - 1) / ${next(limit)}`;
    const ahead = `CASE WHEN ${old(at)} > ${next(at)} THEN ${old(at)} - ${next(at)} ELSE 0 END`;
    const row = await db.queryOne<{ wait: number }>(
      `INSERT INTO ${table} (${this.quote('key')}, ${limit}, ${window}, ${at}, ${debt}, ${wait}) ` +
        `VALUES (?, ${int}, ${int}, ${int}, ${int}, 0) ` +
        `ON CONFLICT (${this.quote('key')}) DO UPDATE SET ` +
        `${at} = CASE WHEN NOT (${allowed}) THEN ${old(at)} ` +
        `WHEN ${fresh} OR ${next(at)} >= ${old(at)} THEN ${next(at)} ELSE ${old(at)} END, ` +
        `${debt} = CASE WHEN ${allowed} THEN ${due} ELSE ${old(debt)} END, ` +
        `${wait} = CASE WHEN ${allowed} THEN 0 ` +
        `ELSE ${refill} + ${ahead} END, ` +
        `${limit} = ${next(limit)}, ${window} = ${next(window)} ` +
        `RETURNING ${wait}`,
      [key, rate.limit, rate.window, now, rate.window],
    );
    return Number(row?.wait ?? 0);
  }

  /**
   * Gives `key` its full rate-limit budget back by deleting its row.
   *
   * @example
   * ```ts
   * await dialect.resetRateLimit(db, 'login')
   * ```
   */
  async resetRateLimit(db: DatabaseAdapter, key: string): Promise<void> {
    await this.ensureRateLimitTable(db);
    await db.run(`DELETE FROM ${this.quote(OHNE_RATE_LIMITS)} WHERE ${this.quote('key')} = ?`, [
      key,
    ]);
  }

  /**
   * Deletes up to `batch` rate-limit rows whose budget is full again at `now`, resolving how many went.
   * Such a row counts exactly as a missing one, so deleting it never forgives anything.
   *
   * @example
   * ```ts
   * await dialect.sweepRateLimits(db, Date.now(), 1000) // -> 42
   * ```
   */
  async sweepRateLimits(db: DatabaseAdapter, now: number, batch: number): Promise<number> {
    await this.ensureRateLimitTable(db);
    const table = this.quote(OHNE_RATE_LIMITS);
    const expired =
      `${this.quote('at')} + ${this.quote('window')} <= ` +
      `CAST(? AS ${this.columnType('integer')})`;
    // Rechecking outside the subquery keeps a row another connection just renewed.
    const { changes } = await db.run(
      `DELETE FROM ${table} WHERE ${expired} AND ${this.quote('key')} IN ` +
        `(SELECT ${this.quote('key')} FROM ${table} WHERE ${expired} LIMIT ?)`,
      [now, now, batch],
    );
    return changes;
  }

  /**
   * Ensures the `ohne_rate_limits` table exists, tolerating a concurrent create.
   * It runs once per adapter, since DDL on every hit would flush a driver's statement cache.
   */
  protected async ensureRateLimitTable(db: DatabaseAdapter): Promise<void> {
    if (rateLimitTables.has(db)) return;
    const integer = this.columnType('integer');
    await db.exec(
      `CREATE TABLE IF NOT EXISTS ${this.quote(OHNE_RATE_LIMITS)} (` +
        `${this.quote('key')} ${this.columnType('text')} PRIMARY KEY, ` +
        ['limit', 'window', 'at', 'debt', 'wait']
          .map((column) => `${this.quote(column)} ${integer} NOT NULL`)
          .join(', ') +
        ')',
    );
    rateLimitTables.add(db);
  }
}
