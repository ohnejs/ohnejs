import type { FieldInstance } from '../fields/field.ts';
import type { NamedMiddlewareKey } from '../middleware/known-middleware.ts';
import type { QueryScope } from '../query/wire/apply.ts';

import { validateCollectionDefinition } from './validate-collection.ts';

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
   */
  select?: (TField | 'UUID' | '_updatedAt')[];
}

/**
 * Options of one exposed collection-API operation.
 */
export interface CollectionEndpoint<TField extends string = string> {
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
   * A returned scope composes into every query the operation runs.
   * Its `where` ANDs in, so an out-of-scope record answers the same `404` a missing one does.
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
   * }
   * ```
   */
  access?: () => AccessScope<TField> | boolean | Promise<AccessScope<TField> | boolean>;
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
  read?: boolean | 'public' | CollectionEndpoint<TField>;

  /**
   * Opens `POST /collections/<name>` - creating a record.
   *
   * @default
   * false
   */
  create?: boolean | 'public' | CollectionEndpoint<TField>;

  /**
   * Opens `PATCH /collections/<name>/<uuid>` - updating one record.
   *
   * @default
   * false
   */
  update?: boolean | 'public' | CollectionEndpoint<TField>;

  /**
   * Opens `DELETE /collections/<name>/<uuid>` - deleting one record.
   *
   * @default
   * false
   */
  delete?: boolean | 'public' | CollectionEndpoint<TField>;
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
 * import { defineCollection, field } from 'ohne'
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
