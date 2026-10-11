/**
 * Codegen extension point for the collections the app registers.
 * Empty until codegen runs; the `browser/collections.ts` it emits extends it with every collection.
 *
 * `type` aliases cannot be augmented, so the known names live on this interface instead.
 *
 * @example
 * ```ts
 * declare module 'ohnejs/dashboard' {
 *   interface KnownCollections {
 *     Posts: { UUID: string; title: string }
 *   }
 * }
 * ```
 */
export interface KnownCollections {}

/**
 * The name of a registered collection, as a `record` field's `collection` names it.
 * Narrows to the generated union of names once codegen has run; falls back to `string` until then.
 */
export type CollectionName = [keyof KnownCollections] extends [never]
  ? string
  : keyof KnownCollections;
