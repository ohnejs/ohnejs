/**
 * Codegen extension point naming every singleton collection.
 * Empty until codegen runs; the generated `database.ts` augments it with one member per singleton.
 * The query builder reads it to drop `create` and `delete` and to answer `findFirst` without `undefined`.
 *
 * `type` aliases cannot be augmented, so the names live on this interface instead.
 *
 * @example
 * ```ts
 * declare module 'ohnejs' {
 *   interface KnownSingletons {
 *     SEO: true
 *   }
 * }
 * ```
 */
export interface KnownSingletons {}
