/**
 * Codegen extension point for every known collection name.
 * Empty until codegen runs; the `database.ts` it emits augments this with one member per collection.
 * Each member maps the collection name to its generated record shape.
 *
 * `type` aliases cannot be augmented, so the collection names live on this interface instead.
 *
 * @example
 * ```ts
 * declare module 'ohnejs' {
 *   interface KnownCollections extends GeneratedCollections {}
 * }
 * ```
 */
export interface KnownCollections {}

/**
 * Any collection name in the app's combined schema.
 * Narrows to the generated union once codegen has run; falls back to `string` until then.
 */
export type CollectionName = [keyof KnownCollections] extends [never]
  ? string
  : keyof KnownCollections;
