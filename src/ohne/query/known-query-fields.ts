import type { ConditionObject } from '../../utils/index.ts';
import type { CollectionName } from '../collections/known-collections.ts';

/**
 * One field's compile-time query metadata: the closed vocabulary the generated table emits.
 *
 * The type-level twin of `FieldQueryMeta`, read by the builder's operator narrowing.
 * A plain column carries `scalar`; a `record` FK carries `scalar` plus its target.
 * A `records`, composite, or blocks field carries only its relation marker.
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
   * Marks a write-only field: the default row shape omits it, an explicit `select` keeps it.
   */
  readable?: false;

  /**
   * Marks a translatable column-bearing field: it holds one value per locale.
   * It reads `null` where the queried locale holds no translation, so `isNull` always applies.
   */
  companion?: true;

  /**
   * Marks a translatable derived table: its rows live per locale.
   */
  localeScoped?: true;

  /**
   * The target collection of a `record` foreign key, by name.
   */
  record?: string;

  /**
   * The target collection of a `records` relation, by name; the inverse side names it the same.
   */
  records?: string;

  /**
   * The union of block type names a blocks field admits.
   * The two-step `has` narrows through `KnownBlockQueryFields` by the type it names.
   */
  blocks?: string;

  /**
   * The cardinality of a composite child field: one child row per parent, or many.
   */
  child?: 'one' | 'many';

  /**
   * A composite child's own field table, its item `UUID` included; `child` kinds only.
   */
  fields?: Record<string, QueryFieldMeta>;

  /**
   * The field's `when` condition, in object form, present only when the instance declares one.
   * A type-only passenger: the dashboard's field-visibility logic reads it; the query builder ignores it.
   */
  when?: ConditionObject;
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
