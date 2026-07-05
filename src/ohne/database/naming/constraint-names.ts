import { physicalName } from './_physical.ts';

/**
 * The primary-key constraint name of a table.
 *
 * @example
 * ```ts
 * primaryKeyName('Posts') // -> 'PK__Posts'
 * ```
 */
export function primaryKeyName(table: string): string {
  return physicalName(`PK__${table}`);
}

/**
 * The unique-constraint name over one or more columns, listed in defined order.
 * Internal columns keep their leading `_`, so the joins may double up; names are exact-match only.
 *
 * @example
 * ```ts
 * uniqueName('Users', ['email']) // -> 'UX__Users__email'
 *
 * uniqueName('Posts_authors', ['_parentUUID', '_targetUUID'])
 * // -> 'UX__Posts_authors___parentUUID__targetUUID'
 * ```
 */
export function uniqueName(table: string, columns: readonly string[]): string {
  return physicalName(`UX__${table}__${columns.join('_')}`);
}

/**
 * The index name over one or more columns, listed in defined order.
 *
 * @example
 * ```ts
 * indexName('Posts', ['author']) // -> 'IX__Posts__author'
 * ```
 */
export function indexName(table: string, columns: readonly string[]): string {
  return physicalName(`IX__${table}__${columns.join('_')}`);
}

/**
 * The logical foreign-key name of a column.
 * A dialect with unnamed foreign keys, like SQLite, never writes it into the database.
 *
 * @example
 * ```ts
 * foreignKeyName('Posts', 'author') // -> 'FK__Posts__author'
 * ```
 */
export function foreignKeyName(table: string, column: string): string {
  return physicalName(`FK__${table}__${column}`);
}
