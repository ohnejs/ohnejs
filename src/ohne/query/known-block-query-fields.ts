import type { BlockName } from '../blocks/known-blocks.ts';
import type { QueryFieldMeta } from './known-query-fields.ts';

/**
 * Codegen extension point mapping every block to its per-field query metadata table.
 * Empty until codegen runs; the generated `database.ts` augments it with one member per block.
 * A member maps each field name (the item `UUID` included) to its `QueryFieldMeta`.
 *
 * `type` aliases cannot be augmented, so the table lives on this interface instead.
 *
 * @example
 * ```ts
 * declare module 'ohnejs' {
 *   interface KnownBlockQueryFields extends GeneratedBlockQueryFields {}
 * }
 * ```
 */
export interface KnownBlockQueryFields {}

/**
 * The query-field table of one block.
 * Narrows to the generated table once codegen has run; falls back to a permissive map until then.
 */
export type BlockQueryFieldsOf<B extends BlockName> = B extends keyof KnownBlockQueryFields
  ? KnownBlockQueryFields[B]
  : Record<string, QueryFieldMeta>;
