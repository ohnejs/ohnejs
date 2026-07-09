/**
 * Codegen extension point mapping every collection to its owning `records` fields.
 * Empty until codegen runs; the generated `database.ts` augments it with one member per collection.
 * A member maps each owning (non-`inverse`) `records` field name to its target collection's name.
 * Top-level collection fields only, by contract: a nested field can never be an `inverse` target.
 *
 * `type` aliases cannot be augmented, so the map lives on this interface instead.
 *
 * @example
 * ```ts
 * declare module 'ohne' {
 *   interface KnownRelations {
 *     Posts: { authors: 'Users' };
 *     Users: {};
 *   }
 * }
 * ```
 */
export interface KnownRelations {}
