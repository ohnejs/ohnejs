import type { CollectionName } from '../collections/known-collections.ts';

/**
 * Codegen extension point mapping every collection to its update-input shape.
 * Empty until codegen runs; the generated `database.ts` augments it with one member per collection.
 * A member describes what `update` accepts: every field optional, a repeater item carrying an optional `UUID`.
 *
 * `type` aliases cannot be augmented, so the table lives on this interface instead.
 *
 * @example
 * ```ts
 * declare module 'ohne' {
 *   interface KnownUpdates extends GeneratedUpdates {}
 * }
 * ```
 */
export interface KnownUpdates {}

/**
 * The update-input shape of one collection.
 * Narrows to the generated shape once codegen has run; falls back to a permissive record until then.
 */
export type UpdateInputOf<C extends CollectionName> = C extends keyof KnownUpdates
  ? KnownUpdates[C]
  : Record<string, unknown>;
