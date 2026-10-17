/**
 * Codegen extension point naming every collection that declares `duplicate: false`.
 * Empty until codegen runs; the generated `database.ts` augments it with one member per such collection.
 * The query builder reads it to drop `duplicate` and `duplicateOrThrow`.
 *
 * `type` aliases cannot be augmented, so the names live on this interface instead.
 *
 * @example
 * ```ts
 * declare module 'ohnejs' {
 *   interface KnownUnduplicable {
 *     Uploads: true
 *   }
 * }
 * ```
 */
export interface KnownUnduplicable {}
