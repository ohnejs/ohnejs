import type { Transaction } from '../database/adapter.ts';
import type { OrderDirection } from './ir.ts';
import type { QueryRecord } from './read/find.ts';
import type { PaginatedResult } from './read/paginate.ts';
import type { QueryLimits } from './wire/limits.ts';
import type { CreateOutcome } from './write/create.ts';

/**
 * The condition object form a `where` accepts: field keys, comparisons, and logical groups.
 */
export type ConditionInput = Record<string, unknown>;

/**
 * The callback `whereAny` runs: it opens branches off `group` and returns the ones to OR together.
 */
export type WhereGroupBuild = (group: UntypedWhereGroup) => UntypedWhereBranch[];

/**
 * The factory a `whereAny` callback receives: each call opens a fresh OR branch.
 */
export interface UntypedWhereGroup {
  /**
   * Opens a branch seeded with one condition; chain `where` on it to AND more into the same branch.
   */
  where(condition: ConditionInput): UntypedWhereBranch;

  /**
   * Opens a branch that is itself a nested OR group.
   */
  whereAny(build: WhereGroupBuild): UntypedWhereBranch;
}

/**
 * One OR branch under `whereAny`: its conditions AND together, and it may nest further groups.
 */
export interface UntypedWhereBranch {
  /**
   * ANDs another condition into this branch.
   */
  where(condition: ConditionInput): UntypedWhereBranch;

  /**
   * ANDs a nested OR group into this branch.
   */
  whereAny(build: WhereGroupBuild): UntypedWhereBranch;
}

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
   * Adds a disjunction, ANDed onto whatever was already there: the callback's branches OR together.
   * A branch's own conditions AND; zero branches match nothing, mirroring an empty `or` group.
   */
  whereAny(build: WhereGroupBuild): this;

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

  /**
   * Creates one record, returning it on success or the field failures on validation error.
   * The whole write runs in one transaction; nothing persists when it returns a failure.
   */
  create(input: Record<string, unknown>): Promise<CreateOutcome>;

  /**
   * Creates one record and returns it, throwing a `validationError` carrying the failures instead.
   */
  createOrThrow(input: Record<string, unknown>): Promise<QueryRecord>;

  /**
   * Joins an open transaction, so a write terminal runs inside it rather than opening its own.
   */
  use(tx: Transaction): this;
}
