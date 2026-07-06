import type { Transaction } from '../adapter.ts';
import type { LogicalType } from '../dialect.ts';

/**
 * The address of one column: its physical table, its name, and the logical type the address expects.
 * The type pins what the migration believes is live; a drifted column is an error, never a silent skip.
 */
export interface ColumnAddress {
  /**
   * The physical table name.
   */
  table: string;

  /**
   * The column name.
   */
  column: string;

  /**
   * The logical type the column is expected to hold.
   */
  type: LogicalType;
}

/**
 * The address of one table.
 */
export interface TableAddress {
  /**
   * The physical table name.
   */
  table: string;
}

/**
 * Read-only queries a transform may run, bound to the sync transaction.
 * A transform can look values up mid-migration; everything it reads sees the migration so far.
 */
export type MigrationContext = Pick<Transaction, 'query' | 'queryOne'>;

/**
 * Maps one stored value onto its migrated form, called once per row.
 * `value` arrives deserialized as the FROM type; the return value is serialized as the TO type.
 * `row` is the full FROM row, deserialized by column; `ctx` runs read-only queries in the transaction.
 * May return a promise.
 */
export type MigrationTransform = (
  value: unknown,
  row: Readonly<Record<string, unknown>>,
  ctx: MigrationContext,
) => unknown;

/**
 * Moves a column's values onto another column, possibly across tables, possibly retyped.
 * The engine materializes a missing TO from the desired schema, then drops FROM once the values moved.
 */
export interface MoveMigration {
  /**
   * The column the values live in; it must match the live schema or the migration errors.
   */
  from: ColumnAddress;

  /**
   * The column the values move onto, created from the desired schema when it does not exist yet.
   */
  to: ColumnAddress;

  /**
   * Per-row value transform.
   * If omitted, each value carries over unchanged.
   */
  transform?: MigrationTransform;
}

/**
 * Renames a table.
 * Constraint names derive from the table name, so the sync's diff recreates them under the new one.
 */
export interface RenameMigration {
  /**
   * The table as it exists live.
   */
  from: TableAddress;

  /**
   * The table's new name.
   */
  to: TableAddress;
}

/**
 * Drops a column or a whole table on purpose.
 * An intentional drop never needs `force`; the discard is the authorization.
 */
export interface DiscardMigration {
  /**
   * The column or table to drop, matched against the live schema.
   */
  from: ColumnAddress | TableAddress;

  /**
   * Marks the discard: the data is gone on purpose.
   */
  to: null;
}

/**
 * One declarative migration: a move, a rename, or a discard.
 */
export type Migration = MoveMigration | RenameMigration | DiscardMigration;

/**
 * Defines a database migration.
 *
 * Migrations run during sync, inside its transaction, before the structural diff.
 * Each runs once per database and is stamped in `ohne_migrations`.
 * They run in file name order within a layer, furthest layer first.
 * FROM must match the live schema; a mismatch is a hard error naming the drift.
 * A FROM that is entirely absent is the already-migrated case.
 * It skips and stamps, but only when TO is already satisfied.
 *
 * Default-export the result from a file in a layer's `migrations/` directory to register it.
 *
 * @example
 * ```ts
 * // migrations/2026-07-draft-flag.ts - move a column, retyping its values
 * import { defineMigration } from 'ohne'
 *
 * export default defineMigration({
 *   from: { table: 'Posts', column: 'isDraft', type: 'text' },
 *   to: { table: 'Posts', column: 'draft', type: 'boolean' },
 *   transform: (value) => value === 'yes',
 * })
 * ```
 *
 * @example
 * ```ts
 * // migrations/2026-08-articles.ts - rename a table
 * import { defineMigration } from 'ohne'
 *
 * export default defineMigration({
 *   from: { table: 'Posts' },
 *   to: { table: 'Articles' },
 * })
 * ```
 *
 * @example
 * ```ts
 * // migrations/2026-09-drop-legacy.ts - discard a column on purpose
 * import { defineMigration } from 'ohne'
 *
 * export default defineMigration({
 *   from: { table: 'Posts', column: 'legacy', type: 'text' },
 *   to: null,
 * })
 * ```
 */
export function defineMigration(migration: Migration): Migration {
  return migration;
}
