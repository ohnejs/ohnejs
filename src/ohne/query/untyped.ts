import type { OrderDirection } from './ir.ts';
import type { QueryRecord } from './read/find.ts';
import type { PaginatedResult } from './read/paginate.ts';
import type { QueryLimits } from './wire/limits.ts';

/**
 * The condition object form a `where` accepts: field keys, comparisons, and logical groups.
 */
export type ConditionInput = Record<string, unknown>;

/**
 * The runtime query surface every typed builder state is a view of.
 *
 * One class implements it; the typed states narrow its methods, so impl and views can never drift.
 * The wire path drives this surface directly, so replaying a URL query composes through the same methods.
 * The surface carries the read chain - filtering, ordering, the row window - and the read terminals.
 */
export interface UntypedQueryBuilder {
  /**
   * Adds a condition, ANDed onto whatever was already there.
   * The object form parses to the shared AST, and each leaf is gated against the collection's metadata.
   */
  where(condition: ConditionInput): this;

  /**
   * Narrows the read to the named top-level fields, accumulating across calls.
   */
  select(...fields: string[]): this;

  /**
   * Marks `record`/`records` fields to hydrate to full target records, accumulating across calls.
   * A populated field must be one the read fetches; populating a non-relation field is rejected.
   */
  populate(...fields: string[]): this;

  /**
   * Adds a sort key, stacking after the keys already set; a repeated field keeps its first direction.
   */
  orderBy(field: string, direction?: OrderDirection): this;

  /**
   * Caps the number of rows read, replacing any previous cap.
   */
  limit(count: number): this;

  /**
   * Skips the given number of rows, replacing any previous offset.
   */
  offset(count: number): this;

  /**
   * Overrides wire limits for this builder, merging per key so the last value for a key wins.
   * The overrides gate the untrusted wire path; the fluent path is trusted and never limit-checked.
   */
  limits(overrides: Partial<QueryLimits>): this;

  /**
   * Reads every matching record.
   */
  findMany(): Promise<QueryRecord[]>;

  /**
   * Reads the first matching record, or `undefined` when none match.
   */
  findFirst(): Promise<QueryRecord | undefined>;

  /**
   * Counts every matching record.
   */
  count(): Promise<number>;

  /**
   * Whether any record matches.
   */
  exists(): Promise<boolean>;

  /**
   * Reads one page of records with its totals.
   */
  paginate(page: number, perPage: number): Promise<PaginatedResult>;

  /**
   * Reads one field's value from every matching record, in the query's order.
   */
  pluck(field: string): Promise<unknown[]>;
}
