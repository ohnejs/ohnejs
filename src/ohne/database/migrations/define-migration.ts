import type { LiteralUnion } from '../../../utils/index.ts';
import type { KnownCollections } from '../../collections/known-collections.ts';
import type { Transaction } from '../adapter.ts';
import type { LogicalType } from '../dialect.ts';

/**
 * The address of one column: its physical table, its name, and the logical type the address expects.
 * The type pins what the migration believes is live; a drifted column is an error, never a silent skip.
 * The physical spelling is the escape hatch; the logical `collection`/`field` form reads better.
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
 * The physical spelling is the escape hatch; the logical `collection`/`field` form reads better.
 */
export interface TableAddress {
  /**
   * The physical table name.
   */
  table: string;
}

/**
 * The address of one field's column: a collection and a dot path over its field tree.
 * The last path segment is the column; the segments before it name the derived table it sits on.
 * A bare field addresses a column on the collection's main table.
 */
export interface FieldAddress<C extends string = string, F extends string = string> {
  /**
   * The collection's logical name.
   * A `from` may name a collection that no longer exists in code.
   */
  collection: C;

  /**
   * The field's dot path from the collection: `'title'`, or `'sections.title'` inside a composite.
   */
  field: F;

  /**
   * The logical type the column is expected to hold, asserted against the live schema when given.
   * Omitted, the engine resolves it from the live and desired schema.
   * Required only when the `from` is live and the `to` exists nowhere yet.
   * The engine then knows what to create the new column as.
   */
  type?: LogicalType;
}

/**
 * The address of one collection, or of one composite field's table inside it.
 * Without `field` it names the collection itself; a rename then carries every owned table along.
 * With `field` it names the composite's derived table, nested children included.
 */
export interface CollectionAddress<C extends string = string, F extends string = string> {
  /**
   * The collection's logical name.
   * A `from` may name a collection that no longer exists in code.
   */
  collection: C;

  /**
   * A composite field's dot path from the collection, naming its derived table.
   * Omitted, the address names the whole collection.
   */
  field?: F;
}

/**
 * The address of what a discard drops: a field, a composite's table, or a whole collection.
 * What the field materialized as decides the drop.
 * A live column drops as a column; a live derived table drops as a table with its nested children.
 */
export interface DiscardAddress<
  C extends string = string,
  F extends string = string,
> extends CollectionAddress<C, F> {
  /**
   * The logical type the discarded column is expected to hold, asserted against the live schema.
   * Selects the column reading when a same-named derived table lives beside the column.
   */
  type?: LogicalType;
}

/**
 * The suggested field names of one known collection, open to any string for dot paths.
 */
type SuggestedFields<C extends keyof KnownCollections> = LiteralUnion<
  Extract<keyof KnownCollections[C], string>
>;

/**
 * The known collection names as suggestions, open to any string.
 * The open member must carry the literals too.
 * A union member whose `collection` is a bare string silences every suggestion, the literal ones included.
 */
type SuggestedCollections = LiteralUnion<Extract<keyof KnownCollections, string>>;

/**
 * `FieldAddress` narrowed by the known collections.
 * Any collection and field string stays legal: a migration may name things gone from the code.
 */
export type KnownFieldAddress =
  | {
      [C in keyof KnownCollections & string]: FieldAddress<C, SuggestedFields<C>>;
    }[keyof KnownCollections & string]
  | FieldAddress<SuggestedCollections>;

/**
 * `CollectionAddress` narrowed by the known collections.
 * Any collection and field string stays legal: a migration may name things gone from the code.
 */
export type KnownCollectionAddress =
  | {
      [C in keyof KnownCollections & string]: CollectionAddress<C, SuggestedFields<C>>;
    }[keyof KnownCollections & string]
  | CollectionAddress<SuggestedCollections>;

/**
 * `DiscardAddress` narrowed by the known collections.
 * Any collection and field string stays legal: a migration may name things gone from the code.
 */
export type KnownDiscardAddress =
  | {
      [C in keyof KnownCollections & string]: DiscardAddress<C, SuggestedFields<C>>;
    }[keyof KnownCollections & string]
  | DiscardAddress<SuggestedCollections>;

/**
 * The sentinel `deleteRecord()` returns: the whole row dies, not just the transformed cell.
 */
export type DeleteRecord = typeof DELETE_RECORD;

/**
 * The one value of `DeleteRecord`, compared by identity inside the executor.
 */
export const DELETE_RECORD: unique symbol = Symbol('deleteRecord');

/**
 * The context a transform runs in: read-only queries in the sync transaction, and the row in hand.
 * A transform can look values up mid-migration; everything it reads sees the migration so far.
 * `locale` is set on a locale-keyed row - a companion or a locale-scoped derived table - absent otherwise.
 * `deleteRecord()` returns the sentinel that deletes the whole row; return it, never just call it.
 * Only a switch honors the sentinel: a move carries values, so it refuses a deletion.
 */
export interface MigrationContext extends Pick<Transaction, 'query' | 'queryOne'> {
  /**
   * The content locale of the row in hand; absent when the source rows carry no locale.
   */
  locale?: string;

  /**
   * Returns the delete sentinel: `return ctx.deleteRecord()` drops the whole row.
   * A fan-in uses it to resolve surplus locales; everything the row held goes with it.
   */
  deleteRecord(): DeleteRecord;
}

/**
 * The schema attributes a switch migration flips, each a plain boolean state.
 * On `from` they assert the live state; on `to` the target state, usually left to the desired schema.
 */
export interface SwitchAttributes {
  /**
   * Whether the column permits `NULL`.
   */
  nullable?: boolean;

  /**
   * Whether a unique constraint covers the column.
   */
  unique?: boolean;

  /**
   * Whether the column's unique is scoped to one locale.
   */
  uniquePerLocale?: boolean;

  /**
   * Whether the field stores per locale.
   */
  translatable?: boolean;
}

/**
 * Maps one stored value onto its migrated or switched form, called once per row.
 *
 * `value` arrives deserialized as the `from` type; a returned value serializes as the `to` type.
 * `row` is the full `from` row, deserialized by column.
 * On a move, each value carries over rewritten.
 * On a switch, `undefined` keeps the row untouched and `ctx.deleteRecord()` deletes it whole:
 * a fan-in promotes one locale's value per entity this way, and a fan-out reshapes per entity.
 * May return a promise.
 */
export type MigrationTransform = (
  value: unknown,
  row: Readonly<Record<string, unknown>>,
  ctx: MigrationContext,
) => unknown;

/**
 * Moves a column's values onto another column, possibly across tables, possibly retyped.
 * The engine materializes a missing `to` from the desired schema, then drops `from` once the values moved.
 */
export interface MoveMigration {
  /**
   * The field or column the values live in; it must match the live schema or the migration errors.
   */
  from: ColumnAddress | KnownFieldAddress;

  /**
   * The field or column the values move onto, created from the desired schema when missing.
   */
  to: ColumnAddress | KnownFieldAddress;

  /**
   * Per-row value transform.
   * If omitted, each value carries over unchanged.
   */
  transform?: MigrationTransform;
}

/**
 * Renames a collection, a composite field's table, or a physical table.
 * A collection rename carries every owned table along: junctions, child tables, nested children.
 * A composite field rename carries its nested children along the same way.
 * Constraint names derive from table names, so the sync's diff recreates them under the new one.
 */
export interface RenameMigration {
  /**
   * The collection or table as it exists live.
   */
  from: TableAddress | KnownCollectionAddress;

  /**
   * The new name.
   * A field path changes its last segment only; the path prefix stays.
   */
  to: TableAddress | KnownCollectionAddress;
}

/**
 * Drops a field, a composite's table, a whole collection, or a physical column or table on purpose.
 * An intentional drop never needs `force`; the discard is the authorization.
 */
export interface DiscardMigration {
  /**
   * What to drop, matched against the live schema.
   */
  from: ColumnAddress | TableAddress | KnownDiscardAddress;

  /**
   * Marks the discard: the data is gone on purpose.
   */
  to: null;
}

/**
 * At least one switch attribute set, so a switch is never mistaken for a move at the type level.
 * Distributes over the four attributes: each member requires its own key and keeps the rest optional.
 */
type SwitchState = {
  [K in keyof SwitchAttributes]-?: Required<Pick<SwitchAttributes, K>> & SwitchAttributes;
}[keyof SwitchAttributes];

/**
 * Flips one schema attribute of one field, carrying the data the new state needs.
 *
 * `from` addresses the field and asserts its live attribute state; a drifted state is a hard error.
 * Exactly one attribute switches per migration; chain files to flip several.
 * `to` is optional: a boolean has exactly one other state, and the desired schema already holds it.
 * The `translatable` switch is the flip machinery's handle.
 * On -> off runs the fan-in transform once per (entity, locale); off -> on reshapes each entity's value.
 * A `nullable` or `unique` switch runs the transform once per row.
 * Backfills and dedups then satisfy the constraint the guard would otherwise refuse.
 * `translatable` is logical-only: a raw table has no translatable concept.
 */
export interface SwitchMigration {
  /**
   * The field whose attribute flips, carrying the asserted live state.
   */
  from: (ColumnAddress | KnownFieldAddress) & SwitchState;

  /**
   * The target attribute state, as an explicit assertion.
   * Omitted, the engine materializes it from the desired schema.
   */
  to?: SwitchAttributes;

  /**
   * Per-row (or per-entity, on a fan-out) value transform.
   * If omitted, a fan-in promotes the default locale and a value pass keeps every row as it is.
   */
  transform?: MigrationTransform;
}

/**
 * One declarative migration: a move, a rename, a discard, or a switch.
 */
export type Migration = MoveMigration | RenameMigration | DiscardMigration | SwitchMigration;

/**
 * Defines a database migration.
 *
 * Migrations run during sync, inside its transaction, before the structural diff.
 * Each runs once per database and is stamped in `ohne_migrations`.
 * They run in file name order within a layer, furthest layer first.
 * `from` must match the live schema; a mismatch is a hard error naming the drift.
 * A `from` that is entirely absent is the already-migrated case.
 * It skips and stamps, but only when `to` is already satisfied.
 *
 * Addresses are logical (`collection` and a `field` dot path) or physical (`table` and `column`).
 * The logical form is the one to reach for.
 * Physical is the escape hatch for tables and columns the collection naming cannot reach.
 * One migration uses one form: logical pairs with logical, physical with physical.
 * A logical pair reads as a move over a live column, and as a rename over a live derived table.
 *
 * Default-export the result from a file in a layer's `migrations/` directory to register it.
 *
 * @example
 * ```ts
 * // migrations/2026-07-draft-flag.ts - move a field's column, retyping its values
 * import { defineMigration } from 'ohne'
 *
 * export default defineMigration({
 *   from: { collection: 'Posts', field: 'isDraft' },
 *   to: { collection: 'Posts', field: 'draft' },
 *   transform: (value) => value === 'yes',
 * })
 * ```
 *
 * @example
 * ```ts
 * // migrations/2026-08-articles.ts - rename a collection, every owned table following
 * import { defineMigration } from 'ohne'
 *
 * export default defineMigration({
 *   from: { collection: 'Posts' },
 *   to: { collection: 'Articles' },
 * })
 * ```
 *
 * @example
 * ```ts
 * // migrations/2026-09-drop-legacy.ts - discard a field on purpose
 * import { defineMigration } from 'ohne'
 *
 * export default defineMigration({
 *   from: { collection: 'Posts', field: 'legacy' },
 *   to: null,
 * })
 * ```
 *
 * @example
 * ```ts
 * // migrations/2026-10-title-per-post.ts - turn a translatable field back off
 * import { defineMigration } from 'ohne'
 *
 * export default defineMigration({
 *   from: { collection: 'Posts', field: 'title', translatable: true },
 *   transform: (value, row, ctx) => {
 *     if (ctx.locale === 'en') return value
 *     return ctx.deleteRecord()
 *   },
 * })
 * ```
 */
export function defineMigration(migration: Migration): Migration {
  return migration;
}
