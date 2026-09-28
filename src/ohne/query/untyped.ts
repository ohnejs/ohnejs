import type { Transaction } from '../database/adapter.ts';
import type { OrderDirection, TargetReach } from './ir.ts';
import type { QueryRecord } from './read/find.ts';
import type { PaginatedResult } from './read/paginate.ts';
import type { ReachResolver } from './wire/reach.ts';
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
 * One relation's populate sub-query: the query grammar scoped to its target, recursive.
 * `select` narrows which target fields the hydrated records carry; `populate` descends one level further.
 *
 * @example
 * ```ts
 * { select: ['text', 'author'], populate: [{ author: { select: ['name'] } }] }
 * ```
 */
export interface PopulateSubQuery {
  /**
   * The target fields the hydrated records carry, exactly; omitted reads the whole record.
   * `UUID` and `_updatedAt` come back only when named.
   */
  select?: string[];

  /**
   * The target's own relations to hydrate, one level further down.
   * A populated relation must also be named in `select` when one is set, or it silently drops.
   */
  populate?: (string | PopulateSpec)[];
}

/**
 * A populate spec: relation names mapped to their sub-queries, the tree form the wire carries.
 *
 * @example
 * ```ts
 * { comments: { select: ['text', 'author'], populate: ['author'] } }
 * ```
 */
export type PopulateSpec = Record<string, PopulateSubQuery>;

/**
 * The callback the populate sub-builder form runs: it narrows the target with `select` and `populate`.
 *
 * @example
 * ```ts
 * (c) => c.select('text', 'author').populate('author')
 * ```
 */
export type PopulateBuild = (sub: UntypedPopulateBuilder) => UntypedPopulateBuilder;

/**
 * The sub-builder a populate callback receives, scoped to the relation's target collection.
 * It carries only `select` and `populate`, so a spec can narrow and descend but never filter.
 */
export interface UntypedPopulateBuilder {
  /**
   * Narrows the hydrated records to the named target fields, accumulating across calls.
   * A subselected record carries exactly the named fields - `UUID` and `_updatedAt` only when named.
   *
   * @example
   * ```ts
   * queryUntyped('Posts').populate('author', (a) => a.select('name'))
   * ```
   */
  select(...fields: string[]): this;

  /**
   * Hydrates the target's own relations, one level further down; every populate form composes here.
   * A populated relation must be named in this node's `select` when one is set, or it silently drops.
   *
   * @example
   * ```ts
   * queryUntyped('Posts').populate('comments', (c) =>
   *   c.select('text', 'author').populate('author'),
   * )
   * ```
   */
  populate(...entries: (string | PopulateSpec)[]): this;

  /**
   * Hydrates one of the target's relations through its own callback, recursing the grammar.
   *
   * @example
   * ```ts
   * queryUntyped('Posts').populate('comments', (c) =>
   *   c.populate('author', (a) => a.select('name')),
   * )
   * ```
   */
  populate(field: string, build: PopulateBuild): this;
}

/**
 * The runtime query surface every typed builder state is a view of.
 *
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
   * A malformed condition, an unknown field, or an operator its field does not support throws.
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
   * Adds an access scope's condition, ANDed onto whatever was already there, as `where` does.
   * A read also narrows each record's `_translations` to the locales where the record meets it.
   * An update's answered records narrow the same way.
   *
   * @example
   * ```ts
   * queryUntyped('Posts').access({ published: true })
   * ```
   */
  access(condition: ConditionInput): this;

  /**
   * Installs a wire read's own condition and its reach into every collection it crosses.
   * The condition compiles under the reach: a conditioned `has` into an unreachable target matches nothing.
   * A populate hydrates only what the target's reach admits, narrowed to the fields it names.
   * A collection the reach never names reaches nothing, so a read fails closed.
   * A write terminal ANDs the condition in unscoped; the reach narrows reads alone.
   *
   * @example
   * ```ts
   * queryUntyped('Posts').wire({ author: { has: { name: 'Anduin' } } }, new Map([['Users', false]]))
   * ```
   */
  wire(condition: ConditionInput | null, reach: ReadonlyMap<string, TargetReach>): this;

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
   * An entry is a field name (whole record) or a spec object narrowing and descending per relation.
   * A populated field must be one the read fetches; populating a non-relation field is rejected.
   * Repeating a field at one level dedups two bare names and rejects any repeat involving a spec.
   *
   * @example
   * ```ts
   * queryUntyped('Posts').select('title', 'author').populate('author')
   *
   * queryUntyped('Posts').populate({
   *   comments: { select: ['text'], populate: ['author'] },
   * })
   * ```
   */
  populate(...entries: (string | PopulateSpec)[]): this;

  /**
   * Hydrates one relation through a callback sub-builder scoped to its target collection.
   * The callback's `select` and `populate` compose exactly as a spec object's keys do.
   *
   * @example
   * ```ts
   * queryUntyped('Posts').populate('comments', (c) =>
   *   c.select('text', 'author').populate('author'),
   * )
   * ```
   */
  populate(field: string, build: PopulateBuild): this;

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
   * Scopes the query to one content locale; translatable collections only, once per chain.
   * Reads take translatable values from that locale, `null` where no translation exists.
   * Writes route translatable values to that locale's rows.
   * A locale-scoped chain refuses `delete` - `deleteTranslation` removes the locale instead.
   * Without `.locale()`, the default locale from `collections.defaultLocale` applies.
   *
   * @example
   * ```ts
   * await queryUntyped('Posts').locale('de').findMany()
   * ```
   */
  locale(code: string): this;

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
   * Refused on a singleton, whose one record already exists.
   *
   * @example
   * ```ts
   * const outcome = await queryUntyped('Posts').create({ title: 'Hello' })
   * ```
   */
  create(input: Record<string, unknown>): Promise<CreateOutcome>;

  /**
   * Creates one record and returns it, throwing an `isValidationError` error carrying the failures instead.
   * Refused on a singleton, whose one record already exists.
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
   * Updates every matching record and returns them re-read; a failure throws an `isValidationError` error.
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
   * A `restrict` reference still pointing at a matched row throws an `isReferenceViolation` error.
   * Refused on a locale-scoped chain, which must not cascade-delete every locale.
   * Refused on a singleton, whose one record must stay.
   *
   * @example
   * ```ts
   * await queryUntyped('Posts').where({ status: 'spam' }).delete()
   * ```
   */
  delete(): Promise<DeleteOutcome>;

  /**
   * Deletes every matching record's translation at the chain's locale and reports how many held one.
   * The main rows and every other locale survive; each affected record's `_updatedAt` bumps.
   * Requires `.locale()` - the chain's locale names the translation to remove.
   *
   * @example
   * ```ts
   * await queryUntyped('Posts').locale('de').where({ status: 'archived' }).deleteTranslation()
   * ```
   */
  deleteTranslation(): Promise<DeleteOutcome>;

  /**
   * Joins an open transaction, so a write terminal runs inside it rather than opening its own.
   *
   * @example
   * ```ts
   * await queryUntyped('Posts').use(tx).create({ title: 'Hello' })
   * ```
   */
  use(tx: Transaction): this;

  /**
   * Makes the chain skip the app's scoping hooks, so a scope hides no row from it.
   * A read skips `query:filter` and a write skips `record:condition`.
   * A create reads its record back past both.
   * `query:records` still runs.
   * For framework bookkeeping only: the wire layer never reaches it.
   *
   * @example
   * ```ts
   * await queryUntyped('Users').unscoped().exists()
   * await queryUntyped('Sessions').unscoped().where({ UUID }).delete()
   * ```
   */
  unscoped(): this;

  /**
   * Checks every link the write's input provides against `resolve`.
   * An unreachable target then fails as `invalidReference`, like a missing one.
   *
   * @example
   * ```ts
   * await queryUntyped('Posts').linkReach(readReach).createOrThrow(input)
   * ```
   */
  linkReach(resolve: ReachResolver): this;
}
