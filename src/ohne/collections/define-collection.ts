import type { IconName } from '../../utils/icon/icon-name.ts';
import type { FieldInstance } from '../fields/field.ts';
import type { FieldLayout } from '../fields/layout.ts';
import type { NamedMiddlewareKey } from '../middleware/known-middleware.ts';
import type { QueryScope } from '../query/wire/apply.ts';
import type { LocaleCode } from './known-locales.ts';

import { validateCollectionDefinition } from './validate-collection.ts';

export type { IconName } from '../../utils/icon/icon-name.ts';

/**
 * One collections-API operation, as the `api` exposure names it.
 */
export type CollectionOperation = 'read' | 'create' | 'update' | 'delete';

/**
 * The condition form an `access` scope's `where` takes, keyed to the collection's declared fields.
 * Keys complete to the field names; values follow the condition-object grammar every `where` reads.
 * `and` and `or` group, and their nested conditions stay open-keyed.
 * A dot path into a composite's subfields therefore rides under `and`.
 */
export type AccessCondition<TField extends string = string> = {
  [K in TField | 'UUID' | '_updatedAt' | 'and' | 'or']?: unknown;
};

/**
 * The scope an `access` resolver returns: a `QueryScope` typed to the collection's declared fields.
 */
export interface AccessScope<TField extends string = string> extends Omit<
  QueryScope,
  'where' | 'select'
> {
  /**
   * A filter every request is ANDed under, so no request escapes the scope's rows.
   */
  where?: AccessCondition<TField>;

  /**
   * The fields a request may read; a request's own `select` intersects with these, never widening.
   * A field outside them is refused in `where`, `order`, `select`, and `populate`, as an unknown field is.
   * Naming a `readable: false` field reveals it; the resolver is trusted, as a fluent `select` is.
   * `_translations` names the locales a record is translated in; a translatable collection alone has it.
   */
  select?: (TField | 'UUID' | '_updatedAt' | '_translations')[];
}

/**
 * What an `access` resolver learns about the request it scopes.
 * A create or update carries `input`, the write the caller intends, unverified.
 * A read or delete has no input, so its context names the operation alone.
 */
export type AccessContext<TOperation extends CollectionOperation = CollectionOperation> =
  TOperation extends 'create' | 'update'
    ? { operation: TOperation; input: Record<string, unknown> }
    : { operation: TOperation };

/**
 * Options of one exposed collection-API operation.
 */
export interface CollectionEndpoint<
  TField extends string = string,
  TOperation extends CollectionOperation = CollectionOperation,
> {
  /**
   * Opens the operation to anonymous requests, skipping the capability guard.
   * Pair it with `middleware: ['require-auth']` to require a signed-in user without a capability.
   *
   * @default
   * false
   */
  public?: boolean;

  /**
   * Named middleware run before the operation, in order, after the guard and the global middleware.
   * A middleware returning a value answers the request; the operation never runs.
   *
   * @default
   * []
   */
  middleware?: NamedMiddlewareKey[];

  /**
   * Resolves the operation's per-request scope, once the guard and the middleware have passed.
   * The context names the operation; a create or update carries `input`, the write the caller intends.
   * The collections API hands it the JSON body, or an empty write when the body fails to read.
   * A translation copy hands it an empty write to reach the source, then the values it copies.
   * A returned scope composes into every query the operation runs.
   * Its `where` ANDs in, so an out-of-scope record answers the same `404` a missing one does.
   * The filter reads the stored row, so a writable scope key lets a body hand the row out of the scope.
   * `select` narrows what a read returns, what an update accepts, and what a write's answered record carries.
   * `true` runs the operation unscoped; `false` refuses it as that identical `404`.
   * Omitted means unscoped.
   * Identity is ambient: the resolver reads the caller through the auth helpers (`useUser`).
   * A create has no rows to filter, so only the verdict applies.
   * Create-time ownership belongs to a `writable: false` field whose `default` reads the ambient user.
   *
   * @example
   * ```ts
   * api: {
   *   read: {
   *     access: async () => {
   *       const user = await useUser()
   *       return user ? { where: { owner: user.UUID } } : false
   *     },
   *   },
   *   update: {
   *     access: async ({ input }) => {
   *       const user = await requireUser()
   *       return 'owner' in input ? { where: { owner: user.UUID } } : true
   *     },
   *   },
   * }
   * ```
   */
  access?: (
    context: AccessContext<TOperation>,
  ) => AccessScope<TField> | boolean | Promise<AccessScope<TField> | boolean>;
}

/**
 * Per-operation exposure of one collection over the collections API.
 * Every operation is closed until named.
 * `true` opens it guarded: the caller needs the `collection.<Name>.<operation>` capability.
 * `'public'` opens it to anyone; an object opens it with options.
 */
export interface CollectionAPI<TField extends string = string> {
  /**
   * Opens the read endpoints: the list, the by-`UUID` read, and the body-query `POST`.
   *
   * @default
   * false
   */
  read?: boolean | 'public' | CollectionEndpoint<TField, 'read'>;

  /**
   * Opens `POST /collections/<kebab-name>` - creating a record.
   *
   * @default
   * false
   */
  create?: boolean | 'public' | CollectionEndpoint<TField, 'create'>;

  /**
   * Opens `PATCH /collections/<kebab-name>/<uuid>` - updating one record.
   *
   * @default
   * false
   */
  update?: boolean | 'public' | CollectionEndpoint<TField, 'update'>;

  /**
   * Opens `DELETE /collections/<kebab-name>/<uuid>` - deleting one record.
   *
   * @default
   * false
   */
  delete?: boolean | 'public' | CollectionEndpoint<TField, 'delete'>;
}

/**
 * A collection-level index or unique constraint over one or more of the collection's fields.
 */
export interface CompositeIndex<TField extends string = string> {
  /**
   * The collection field names the constraint covers, in order.
   */
  fields: readonly TField[];

  /**
   * Make this a unique constraint instead of a plain index.
   * No two rows may then share the same combination of these fields' values.
   *
   * @default
   * false
   */
  unique?: boolean;
}

/**
 * The system fields a `table.columns` entry may name beside the declared ones.
 * `_translations` exists on a translatable collection alone; naming it elsewhere fails at boot.
 */
type TableSystemField = 'UUID' | '_updatedAt' | '_translations';

/**
 * One `table.columns` entry: a field name, optionally followed by its CSS widths.
 * The parts are `name`, `width`, and `minWidth`, separated by `|`; both widths are optional.
 * Spaces around a separator are trimmed, so `title | 320px` and `title|320px` are the same entry.
 */
export type TableColumnEntry<TField extends string = string> =
  | TField
  | TableSystemField
  | `${TField | TableSystemField}|${string}`
  | `${TField | TableSystemField} | ${string}`;

/**
 * A collection's record-label declaration.
 * One field name, several whose values join in order, or a template naming fields in `{braces}`.
 */
export type RecordLabel<TField extends string = string> =
  | TField
  | readonly TField[]
  | `${string}{${TField}}${string}`;

/**
 * A collection's dashboard list-view defaults.
 */
export interface CollectionTable<TField extends string = string> {
  /**
   * The columns the list view shows, in order, one entry per column.
   * A width is a plain CSS length or percentage; `minWidth` falls back to `256px` without a width.
   * A translatable collection may also name `_translations`, the locales each record is translated in.
   * Omitted, the table shows the first four readable fields with `_updatedAt` closing the set.
   * A translatable collection shows three instead, then `_translations`, then `_updatedAt`.
   *
   * @example
   * ```ts
   * columns: ['title | 320px', 'views', '_updatedAt | 150px']
   * ```
   */
  columns?: readonly TableColumnEntry<TField>[];
}

/**
 * How the dashboard presents a collection: its menu icon, record labels, list view, and editor layout.
 */
export interface CollectionDashboard<TField extends string = string> {
  /**
   * The Tabler icon the dashboard menu shows for this collection.
   * Omitted, the menu row renders no icon.
   * The name completes to the full Tabler set; an unknown one fails at boot.
   *
   * @example
   * ```ts
   * icon: 'note'
   * ```
   */
  icon?: IconName;

  /**
   * The field or fields whose values name a record wherever the dashboard shows one.
   * A list joins its parts with single spaces, skipping empty values.
   * A template names fields in `{braces}`; a literal renders only when every field beside it renders.
   * Each part must name a readable field stored as a plain text column; anything else fails at boot.
   * Omitted, the first readable plain text field names the record.
   *
   * @example
   * ```ts
   * recordLabel: 'title'
   * recordLabel: ['firstName', 'lastName']
   * recordLabel: '{lastName}, {firstName}'
   * ```
   */
  recordLabel?: RecordLabel<TField>;

  /**
   * The list view's defaults for this collection.
   * A viewer's own choice, carried in the `columns` query param, overrides them.
   * A column entry is `name`, `name | width`, or `name | width | minWidth`.
   *
   * @example
   * ```ts
   * table: { columns: ['title | 25% | 256px', 'views', '_updatedAt | 150px'] }
   * ```
   */
  table?: CollectionTable<TField>;

  /**
   * How the record editor arranges the fields: rows, cards, tabs, and rules.
   * A field the layout does not name renders after it, in declaration order.
   * One layout serves create and edit; a field the form cannot show in a mode is skipped.
   * Omitted, the fields stack in declaration order.
   *
   * @example
   * ```ts
   * layout: [
   *   { row: ['title', 'slug | 40%'] },
   *   'body',
   *   {
   *     tabs: [
   *       { label: 'app.posts.seo', fields: ['metaTitle', 'metaDescription'] },
   *       { label: 'Publishing', fields: [{ row: ['publishedAt', 'author'] }] },
   *     ],
   *   },
   *   '---',
   *   {
   *     card: {
   *       label: 'Internal',
   *       collapsible: true,
   *       fields: ['assignee', 'comments'],
   *     },
   *   },
   * ]
   * ```
   */
  layout?: FieldLayout<TField>;
}

/**
 * The context a collection's `copyTranslation` function receives.
 */
export interface CopyTranslationContext {
  /**
   * The record as the source locale reads it, every readable field included.
   */
  source: Record<string, unknown>;

  /**
   * The default write input: the translatable, writable, mutable fields, row `UUID`s shed.
   */
  input: Record<string, unknown>;

  /**
   * The resolved locale the copy reads from, one of `collections.locales`.
   */
  sourceLocale: LocaleCode;

  /**
   * The resolved locale the copy writes to, one of `collections.locales`.
   */
  targetLocale: LocaleCode;
}

/**
 * A collection definition: its fields and any collection-level constraints.
 * The collection name is not declared here; it comes from the file under `dirs.collections`.
 */
export interface CollectionDefinition<
  TFields extends Record<string, FieldInstance> = Record<string, FieldInstance>,
> {
  /**
   * The fields, keyed by their camelCase name.
   *
   * @example
   * ```ts
   * fields: {
   *   title: field('text'),
   *   views: field('integer', { index: true }),
   * }
   * ```
   */
  fields: TFields;

  /**
   * Collection-level composite constraints, one entry per constraint.
   *
   * @default
   * []
   *
   * @example
   * ```ts
   * compositeIndexes: [
   *   { fields: ['email', 'tenantId'], unique: true },
   *   { fields: ['status', 'createdAt'] },
   * ]
   * ```
   */
  compositeIndexes?: readonly CompositeIndex<keyof TFields & string>[];

  /**
   * Exposure over the collections API (`/collections/<kebab-name>`).
   * Omitted or `false`, the collection has no HTTP endpoints.
   * An exposed operation is guarded: the caller needs the `collection.<Name>.<operation>` capability.
   * `true` opens every operation guarded; `'public'` on an operation opens it to anyone instead.
   * An unexposed and an unknown collection answer the identical `404`, so the API reveals nothing.
   *
   * @default
   * false
   *
   * @example
   * ```ts
   * api: {
   *   read: 'public',
   *   create: true,
   *   update: { middleware: ['audit'] },
   * }
   * ```
   */
  api?: boolean | CollectionAPI<keyof TFields & string>;

  /**
   * Makes the collection hold exactly one record.
   * The record is created from the field defaults right after the schema syncs.
   * Every field must therefore be nullable or carry a `default`.
   * A top-level reference cannot `cascade`, since deleting its target would delete the record.
   * `create` and `delete` exist nowhere: `api` may expose `read` and `update` only.
   * The dashboard menu row opens the record editor directly, and `findFirst` always answers the record.
   *
   * @default
   * false
   */
  singleton?: boolean;

  /**
   * Shapes the write input when a translation copies to another locale.
   * The context carries the source record, the computed default `input`, and both resolved locales.
   * The returned object replaces the default input, and the function may be async.
   * Only translatable, writable, mutable fields ever write - other keys never apply.
   * A copy therefore cannot touch values shared across locales.
   * Row `UUID`s are shed from the result, so copied child rows insert as fresh rows.
   * Omitted, the default input writes as is.
   *
   * @example
   * ```ts
   * copyTranslation: ({ input, targetLocale }) => ({
   *   ...input,
   *   title: `${input.title} (${targetLocale})`,
   * })
   * ```
   */
  copyTranslation?: (
    context: CopyTranslationContext,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;

  /**
   * How the dashboard presents this collection: its menu icon, record labels, list view, and editor layout.
   *
   * @example
   * ```ts
   * dashboard: {
   *   icon: 'note',
   *   recordLabel: 'title',
   *   table: { columns: ['title | 320px', '_updatedAt'] },
   *   layout: [{ row: ['title', 'slug'] }, 'body'],
   * }
   * ```
   */
  dashboard?: CollectionDashboard<keyof TFields & string>;
}

/**
 * Any collection definition, whatever fields it declares.
 *
 * `CollectionDefinition` is invariant in `TFields`, since `compositeIndexes` references `keyof TFields`.
 * A concrete definition therefore never assigns to the default-generic form.
 * Registries and codegen hold this widened view instead.
 */
export interface AnyCollectionDefinition {
  /**
   * The fields, keyed by their camelCase name.
   */
  fields: Record<string, FieldInstance>;

  /**
   * Collection-level composite constraints, one entry per constraint.
   *
   * @default
   * []
   */
  compositeIndexes?: readonly CompositeIndex[];

  /**
   * Exposure over the collections API; omitted or `false` means no HTTP endpoints.
   *
   * @default
   * false
   */
  api?: boolean | CollectionAPI;

  /**
   * Makes the collection hold exactly one record, created from the field defaults after the schema syncs.
   *
   * @default
   * false
   */
  singleton?: boolean;

  /**
   * Shapes the write input when a translation copies to another locale; omitted, the default input writes.
   */
  copyTranslation?: (
    context: CopyTranslationContext,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;

  /**
   * How the dashboard presents the collection; omitted, every presentation default applies.
   */
  dashboard?: CollectionDashboard;
}

/**
 * Defines a collection.
 *
 * Default-export the result from a file under a layer's `dirs.collections`.
 * The file names the collection: `collections/Posts.ts` becomes `Posts`.
 *
 * @example
 * ```ts
 * // collections/Posts.ts
 * import { defineCollection, field } from 'ohnejs'
 *
 * export default defineCollection({
 *   fields: {
 *     title: field('text'),
 *     views: field('integer', { index: true }),
 *   },
 * })
 * ```
 */
export function defineCollection<TFields extends Record<string, FieldInstance>>(
  definition: CollectionDefinition<TFields>,
): CollectionDefinition<TFields> {
  validateCollectionDefinition(definition);
  return definition;
}
