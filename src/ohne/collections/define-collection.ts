import type { FieldInstance } from '../fields/field.ts';
import type { NamedMiddlewareKey } from '../middleware/known-middleware.ts';

import { validateCollectionDefinition } from './validate-collection.ts';

/**
 * Options of one exposed collection-API operation.
 */
export interface CollectionEndpoint {
  /**
   * Named middleware run before the operation, in order, after the global middleware.
   * A middleware returning a value answers the request; the operation never runs.
   *
   * @default
   * []
   */
  middleware?: NamedMiddlewareKey[];
}

/**
 * Per-operation exposure of one collection over the collections API.
 * Every operation is closed until named: `true` opens it to anyone, an object opens it with options.
 * Nothing attaches middleware for you - an open operation is public until `middleware` names a guard.
 */
export interface CollectionAPI {
  /**
   * Opens the read endpoints: the list, the by-`UUID` read, and the body-query `POST`.
   *
   * @default
   * false
   */
  read?: boolean | CollectionEndpoint;

  /**
   * Opens `POST /collections/<name>` - creating a record.
   *
   * @default
   * false
   */
  create?: boolean | CollectionEndpoint;

  /**
   * Opens `PATCH /collections/<name>/<uuid>` - updating one record.
   *
   * @default
   * false
   */
  update?: boolean | CollectionEndpoint;

  /**
   * Opens `DELETE /collections/<name>/<uuid>` - deleting one record.
   *
   * @default
   * false
   */
  delete?: boolean | CollectionEndpoint;
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
   * `true` opens every operation to anyone - the API never adds auth on its own.
   * An object opens per operation, each `true` or `{ middleware }` naming its guards.
   * An unexposed and an unknown collection answer the identical `404`, so the API reveals nothing.
   *
   * @default
   * false
   *
   * @example
   * ```ts
   * api: {
   *   read: true,
   *   create: { middleware: ['require-auth'] },
   * }
   * ```
   */
  api?: boolean | CollectionAPI;
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
