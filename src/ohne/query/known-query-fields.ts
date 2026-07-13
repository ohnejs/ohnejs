import type { CollectionName } from '../collections/known-collections.ts';

/**
 * One field's compile-time query metadata: the closed vocabulary the generated table emits.
 *
 * The type-level twin of `FieldQueryMeta`, read by the builder's operator narrowing.
 * A plain column carries `scalar`; a `record` FK carries `scalar` plus its target.
 * A `records` or composite field carries only its relation marker.
 * The markers a field carries decide its operators, exactly as `allowedOperators` does at runtime.
 */
export interface QueryFieldMeta {
  /**
   * The field's emitted value type without `| null`; column and `record` kinds only.
   * Its TypeScript kind gates the scalar operators.
   * `string` unlocks the text trio; ordering wants `string | number`.
   */
  scalar?: unknown;

  /**
   * Marks the `UUID` system entries, restricting them to `equalsTo`/`in`.
   */
  id?: true;

  /**
   * Marks a value shape that admits `null`, unlocking `isNull`; column and `record` kinds only.
   */
  nullable?: true;

  /**
   * Marks a `json` column holding a list, unlocking the `includes*` operators.
   */
  jsonList?: true;

  /**
   * The target collection of a `record` foreign key, by name.
   */
  record?: string;

  /**
   * The target collection of a `records` relation, by name; the inverse side names it the same.
   */
  records?: string;

  /**
   * The cardinality of a composite child field: one child row per parent, or many.
   */
  child?: 'one' | 'many';

  /**
   * A composite child's own field table, its item `UUID` included; `child` kinds only.
   */
  fields?: Record<string, QueryFieldMeta>;
}

/**
 * Codegen extension point mapping every collection to its per-field query metadata table.
 * Empty until codegen runs; the generated `database.ts` augments it with one member per collection.
 * A member maps each field name (system fields included) to its `QueryFieldMeta`.
 *
 * `type` aliases cannot be augmented, so the table lives on this interface instead.
 *
 * @example
 * ```ts
 * declare module 'ohne' {
 *   interface KnownQueryFields extends GeneratedQueryFields {}
 * }
 * ```
 */
export interface KnownQueryFields {}

/**
 * The query-field table of one collection.
 * Narrows to the generated table once codegen has run; falls back to a permissive map until then.
 */
export type QueryFieldsOf<C extends CollectionName> = C extends keyof KnownQueryFields
  ? KnownQueryFields[C]
  : Record<string, QueryFieldMeta>;
