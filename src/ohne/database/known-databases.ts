/**
 * Codegen extension point for the known helper-database names.
 * Empty until codegen runs; the generated database module augments it with one member per helper.
 *
 * `type` aliases cannot be augmented, so the overridable names live on this interface instead.
 *
 * @example
 * ```ts
 * declare module 'ohnejs' {
 *   interface KnownDatabases {
 *     rateLimit: true
 *   }
 * }
 * ```
 */
export interface KnownDatabases {}

/**
 * The name of a helper database, passed to `useDatabase`.
 * Narrows to the union of helper names once codegen has run; falls back to `string` until then.
 */
export type DatabaseName = [keyof KnownDatabases] extends [never] ? string : keyof KnownDatabases;
