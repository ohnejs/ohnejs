import type { CollectionName } from '../collections/known-collections.ts';

/**
 * Codegen extension point mapping every collection to its create-input shape.
 * Empty until codegen runs; the generated `database.ts` augments it with one member per collection.
 * A member describes what `create` accepts: relations as `UUID`s, composites nested, system fields absent.
 *
 * `type` aliases cannot be augmented, so the table lives on this interface instead.
 *
 * @example
 * ```ts
 * declare module 'ohnejs' {
 *   interface KnownInserts extends GeneratedInserts {}
 * }
 * ```
 */
export interface KnownInserts {}

/**
 * The create-input shape of one collection.
 * Narrows to the generated shape once codegen has run; falls back to a permissive record until then.
 */
export type InsertInputOf<C extends CollectionName> = C extends keyof KnownInserts
  ? KnownInserts[C]
  : Record<string, unknown>;
