import type { Transaction } from '../database/adapter.ts';
import type { OrderDirection } from './ir.ts';
import type { QueryRecord } from './read/find.ts';
import type { PaginatedResult } from './read/paginate.ts';
import type { QueryGuards } from './wire/guards.ts';
import type { CreateOutcome } from './write/create.ts';
import type { DeleteOutcome } from './write/delete.ts';
import type { UpdateOutcome } from './write/update.ts';

/**
 * The condition object form a `where` accepts: field keys, comparisons, and logical groups.
 *
 * @example
 * ```ts
 * { status: 'published', views: { atLeast: 100 } }
 * ```
 */
export type ConditionInput = Record<string, unknown>;

/**
 * The callback `whereAny` runs: it opens branches off `group` and returns the ones to OR together.
 *
 * @example
 * ```ts
 * (g) => [
 *   g.where({ featured: true }),
 *   g.where({ views: { atLeast: 1000 } }),
 * ]
 * ```
 */
export type WhereGroupBuild = (group: UntypedWhereGroup) => UntypedWhereBranch[];

/**
 * The factory a `whereAny` callback receives: each call opens a fresh OR branch.
 */
export interface UntypedWhereGroup {
  /**
   * Opens a branch seeded with one condition; chain `where` on it to AND more into the same branch.
   *
   * @example
   * ```ts
   * queryUntyped('Posts').whereAny((g) => [g.where({ featured: true })])
   * ```
   */
  where(condition: ConditionInput): UntypedWhereBranch;

  /**
   * Opens a branch that is itself a nested OR group.
   *
   * @example
   * ```ts
   * queryUntyped('Posts').whereAny((g) => [
   *   g.whereAny((h) => [h.where({ a: 1 })]),
   * ])
   * ```
   */
  whereAny(build: WhereGroupBuild): UntypedWhereBranch;
}

/**
 * One OR branch under `whereAny`: its conditions AND together, and it may nest further groups.
 */
export interface UntypedWhereBranch {
  /**
   * ANDs another condition into this branch.
   *
   * @example
   * ```ts
   * queryUntyped('Posts').whereAny((g) => [
   *   g.where({ featured: true }).where({ pinned: true }),
   * ])
   * ```
   */
  where(condition: ConditionInput): UntypedWhereBranch;

  /**
   * ANDs a nested OR group into this branch.
   *
   * @example
   * ```ts
   * queryUntyped('Posts').whereAny((g) => [
   *   g.where({ a: 1 }).whereAny((h) => [h.where({ b: 2 })]),
   * ])
   * ```
   */
  whereAny(build: WhereGroupBuild): UntypedWhereBranch;
}

/**
 * The runtime query surface every typed builder state is a view of.
 *
 * One class implements it; the typed states narrow its methods, so impl and views can never drift.
 * The wire path drives this surface directly, so replaying a URL query composes through the same methods.
 * The surface carries the read chain - filtering, ordering, the row window - and the read terminals.
 * The typed `query` narrows this; `queryUntyped` returns it raw, for the wire and other dynamic callers.
 *
 * @example
 * ```ts
 * const posts = await queryUntyped('Posts')
 *   .where({ status: 'published', views: { atLeast: 100 } })
 *   .select('title', 'views')
 *   .orderBy('views', 'desc')
 *   .limit(20)
 *   .findMany()
 * ```
 */
export interface UntypedQueryBuilder {
  /**
   * Adds a condition, ANDed onto whatever was already there.
   * The object form parses to the shared AST, and each leaf is gated against the collection's metadata.
   *
   * @example
   * ```ts
   * queryUntyped('Posts').where({ status: 'published' })
   * queryUntyped('Posts').where({ views: { atLeast: 100 } })
   * ```
   */
  where(condition: ConditionInput): this;

  /**
   * Adds a disjunction, ANDed onto whatever was already there: the callback's branches OR together.
   * A branch's own conditions AND; zero branches match nothing, mirroring an empty `or` group.
   *
   * @example
   * ```ts
   * queryUntyped('Posts').whereAny((g) => [
   *   g.where({ featured: true }),
   *   g.where({ pinned: true }),
   * ])
   * ```
   */
  whereAny(build: WhereGroupBuild): this;

  /**
   * Narrows the read to the named top-level fields, accumulating across calls.
   *
   * @example
   * ```ts
   * queryUntyped('Posts').select('title', 'views')
   * ```
   */
  select(...fields: string[]): this;

  /**
   * Marks `record`/`records` fields to hydrate to full target records, accumulating across calls.
   * A populated field must be one the read fetches; populating a non-relation field is rejected.
   *
   * @example
   * ```ts
   * queryUntyped('Posts').select('title', 'author').populate('author')
   * ```
   */
  populate(...fields: string[]): this;

  /**
   * Adds a sort key, stacking after the keys already set; a repeated field keeps its first direction.
   *
   * @example
   * ```ts
   * queryUntyped('Posts').orderBy('views', 'desc').orderBy('title')
   * ```
   */
  orderBy(field: string, direction?: OrderDirection): this;

  /**
   * Caps the number of rows read, replacing any previous cap.
   *
   * @example
   * ```ts
   * queryUntyped('Posts').limit(20)
   * ```
   */
  limit(count: number): this;

  /**
   * Skips the given number of rows, replacing any previous offset.
   *
   * @example
   * ```ts
   * queryUntyped('Posts').limit(20).offset(40)
   * ```
   */
  offset(count: number): this;

  /**
   * Overrides the wire guards for this builder, merging per key so the last value for a key wins.
   * The overrides gate the untrusted wire path; the fluent path is trusted and never guard-checked.
   *
   * @example
   * ```ts
   * queryUntyped('Posts').guards({ maxPerPage: 100 })
   * ```
   */
  guards(overrides: Partial<QueryGuards>): this;

  /**
   * Reads every matching record.
   *
   * @example
   * ```ts
   * await queryUntyped('Posts').where({ status: 'published' }).findMany()
   * ```
   */
  findMany(): Promise<QueryRecord[]>;

  /**
   * Reads the first matching record, or `undefined` when none match.
   *
   * @example
   * ```ts
   * await queryUntyped('Posts').orderBy('views', 'desc').findFirst()
   * ```
   */
  findFirst(): Promise<QueryRecord | undefined>;

  /**
   * Counts every matching record.
   *
   * @example
   * ```ts
   * await queryUntyped('Posts').where({ status: 'published' }).count()
   * ```
   */
  count(): Promise<number>;

  /**
   * Whether any record matches.
   *
   * @example
   * ```ts
   * await queryUntyped('Posts').where({ slug: 'hello-world' }).exists()
   * ```
   */
  exists(): Promise<boolean>;

  /**
   * Reads one page of records with its totals.
   *
   * @example
   * ```ts
   * await queryUntyped('Posts').orderBy('views', 'desc').paginate(1, 20)
   * ```
   */
  paginate(page: number, perPage: number): Promise<PaginatedResult>;

  /**
   * Reads one field's value from every matching record, in the query's order.
   *
   * @example
   * ```ts
   * await queryUntyped('Posts').where({ status: 'published' }).pluck('title')
   * ```
   */
  pluck(field: string): Promise<unknown[]>;

  /**
   * Creates one record, returning it on success or the field failures on validation error.
   * The whole write runs in one transaction; nothing persists when it returns a failure.
   *
   * @example
   * ```ts
   * const outcome = await queryUntyped('Posts').create({ title: 'Hello' })
   * ```
   */
  create(input: Record<string, unknown>): Promise<CreateOutcome>;

  /**
   * Creates one record and returns it, throwing a `validationError` carrying the failures instead.
   *
   * @example
   * ```ts
   * const post = await queryUntyped('Posts').createOrThrow({ title: 'Hello' })
   * ```
   */
  createOrThrow(input: Record<string, unknown>): Promise<QueryRecord>;

  /**
   * Updates every matching record, returning them re-read on success or the field failures on error.
   * The whole write runs in one transaction; nothing persists when it returns a failure.
   *
   * @example
   * ```ts
   * await queryUntyped('Posts')
   *   .where({ status: 'draft' })
   *   .update({ status: 'archived' })
   * ```
   */
  update(input: Record<string, unknown>): Promise<UpdateOutcome>;

  /**
   * Updates every matching record and returns them re-read, throwing a `validationError` on failure instead.
   *
   * @example
   * ```ts
   * await queryUntyped('Posts')
   *   .where({ slug: 'hello' })
   *   .updateOrThrow({ title: 'New' })
   * ```
   */
  updateOrThrow(input: Record<string, unknown>): Promise<QueryRecord[]>;

  /**
   * Deletes every matching record and reports how many were removed.
   * A `restrict` reference still pointing at a matched row throws a `referenceViolation`.
   *
   * @example
   * ```ts
   * await queryUntyped('Posts').where({ status: 'spam' }).delete()
   * ```
   */
  delete(): Promise<DeleteOutcome>;

  /**
   * Joins an open transaction, so a write terminal runs inside it rather than opening its own.
   *
   * @example
   * ```ts
   * await queryUntyped('Posts').use(tx).create({ title: 'Hello' })
   * ```
   */
  use(tx: Transaction): this;
}
