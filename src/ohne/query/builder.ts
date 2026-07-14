import type { DeepPrettify } from '../../utils/index.ts';
import type { CollectionName, KnownCollections } from '../collections/known-collections.ts';
import type { Transaction } from '../database/adapter.ts';
import type { OrderDirection } from './ir.ts';
import type { InsertInputOf } from './known-inserts.ts';
import type { KnownQueryFields, QueryFieldMeta } from './known-query-fields.ts';
import type { UpdateInputOf } from './known-updates.ts';
import type { UntypedQueryBuilder } from './untyped.ts';
import type { QueryLimits } from './wire/limits.ts';
import type { FieldErrors } from './write/errors.ts';

/**
 * The query-field table of one collection or relation target, by name.
 * Narrows to the generated table once codegen has run; falls back to a permissive map until then.
 */
type FieldsOf<C extends string> = C extends keyof KnownQueryFields
  ? KnownQueryFields[C]
  : Record<string, QueryFieldMeta>;

/**
 * The generated read shape of one collection, or a permissive record until codegen has run.
 */
type RecordOf<C extends string> = C extends keyof KnownCollections
  ? KnownCollections[C]
  : Record<string, unknown>;

/**
 * One field's metadata within a collection, or `never` when the name is not a field.
 */
type FieldMetaOf<C extends CollectionName, K> = K extends keyof FieldsOf<C>
  ? FieldsOf<C>[K]
  : never;

/**
 * The field's emitted value type without `| null`; `never` when the field carries no scalar.
 */
type ScalarOf<M extends QueryFieldMeta> = M extends { scalar: infer S } ? S : never;

/**
 * The scalar of a plain column, with `record` and the `UUID` entries excluded.
 * Ordering and the text operators then never leak onto a foreign key or an identity column.
 */
type PlainScalar<M extends QueryFieldMeta> = M extends { record: string }
  ? never
  : M extends { id: true }
    ? never
    : ScalarOf<M>;

/**
 * `equalsTo`/`in`, admitted where a scalar exists and is a comparable primitive.
 * `record` and the `UUID` entries carry `scalar: string`, so both compare the raw stored `UUID`.
 */
type EqualityOps<M extends QueryFieldMeta> = [ScalarOf<M>] extends [never]
  ? object
  : ScalarOf<M> extends string | number | boolean
    ? {
        /**
         * Matches rows whose value equals `value`.
         *
         * @example
         * ```ts
         * query('Posts').where('status', (w) => w.equalsTo('published'))
         * ```
         */
        equalsTo(value: ScalarOf<M>): WhereFieldAfterOp<M>;
      }
    : object;

/**
 * `in`, admitted for text and integer scalars, `record`, and the `UUID` entries.
 */
type InOps<M extends QueryFieldMeta> = [ScalarOf<M>] extends [never]
  ? object
  : ScalarOf<M> extends string | number
    ? {
        /**
         * Matches rows whose value is one of `values`; an empty list matches nothing.
         *
         * @example
         * ```ts
         * query('Posts').where('status', (w) => w.in(['draft', 'published']))
         * ```
         */
        in(values: readonly ScalarOf<M>[]): WhereFieldAfterOp<M>;
      }
    : object;

/**
 * The ordering comparisons, admitted for text and integer columns alone (never a `record`/`UUID`).
 */
type OrderingOps<M extends QueryFieldMeta> = [PlainScalar<M>] extends [never]
  ? object
  : PlainScalar<M> extends string | number
    ? {
        /**
         * Matches rows whose value is strictly greater than `value`.
         *
         * @example
         * ```ts
         * query('Posts').where('views', (w) => w.greaterThan(100))
         * ```
         */
        greaterThan(value: PlainScalar<M>): WhereFieldAfterOp<M>;

        /**
         * Matches rows whose value is greater than or equal to `value`.
         *
         * @example
         * ```ts
         * query('Posts').where('views', (w) => w.atLeast(100))
         * ```
         */
        atLeast(value: PlainScalar<M>): WhereFieldAfterOp<M>;

        /**
         * Matches rows whose value is strictly less than `value`.
         *
         * @example
         * ```ts
         * query('Posts').where('views', (w) => w.lessThan(10))
         * ```
         */
        lessThan(value: PlainScalar<M>): WhereFieldAfterOp<M>;

        /**
         * Matches rows whose value is less than or equal to `value`.
         *
         * @example
         * ```ts
         * query('Posts').where('views', (w) => w.atMost(10))
         * ```
         */
        atMost(value: PlainScalar<M>): WhereFieldAfterOp<M>;
      }
    : object;

/**
 * The substring operators plus the raw `like` escape hatch, admitted for text columns alone.
 */
type TextOps<M extends QueryFieldMeta> = [PlainScalar<M>] extends [never]
  ? object
  : PlainScalar<M> extends string
    ? {
        /**
         * Matches rows whose text contains `value`, case-insensitively.
         *
         * @example
         * ```ts
         * query('Posts').where('title', (w) => w.contains('ohne'))
         * ```
         */
        contains(value: string): WhereFieldAfterOp<M>;

        /**
         * Matches rows whose text starts with `value`, case-insensitively.
         *
         * @example
         * ```ts
         * query('Posts').where('title', (w) => w.startsWith('The'))
         * ```
         */
        startsWith(value: string): WhereFieldAfterOp<M>;

        /**
         * Matches rows whose text ends with `value`, case-insensitively.
         *
         * @example
         * ```ts
         * query('Posts').where('title', (w) => w.endsWith('guide'))
         * ```
         */
        endsWith(value: string): WhereFieldAfterOp<M>;

        /**
         * Matches rows against a raw SQL `LIKE` pattern, `%` and `_` unescaped - the power escape hatch.
         *
         * @example
         * ```ts
         * query('Posts').where('slug', (w) => w.like('draft-%'))
         * ```
         */
        like(pattern: string): WhereFieldAfterOp<M>;
      }
    : object;

/**
 * The element type a `jsonList` column's membership operators take.
 */
type JsonElement<M extends QueryFieldMeta> = ScalarOf<M> extends readonly (infer E)[] ? E : unknown;

/**
 * The list-membership operators, admitted for a `json` column flagged as a list.
 */
type JsonOps<M extends QueryFieldMeta> = M extends { jsonList: true }
  ? {
      /**
       * Matches rows whose list contains `value`.
       *
       * @example
       * ```ts
       * query('Posts').where('labels', (w) => w.includes('urgent'))
       * ```
       */
      includes(value: JsonElement<M>): WhereFieldAfterOp<M>;

      /**
       * Matches rows whose list contains every one of `values`.
       *
       * @example
       * ```ts
       * query('Posts').where('labels', (w) => w.includesAll(['urgent', 'draft']))
       * ```
       */
      includesAll(values: readonly JsonElement<M>[]): WhereFieldAfterOp<M>;

      /**
       * Matches rows whose list contains at least one of `values`.
       *
       * @example
       * ```ts
       * query('Posts').where('labels', (w) => w.includesAny(['urgent', 'draft']))
       * ```
       */
      includesAny(values: readonly JsonElement<M>[]): WhereFieldAfterOp<M>;
    }
  : object;

/**
 * `isNull`, the only null test, admitted for a nullable column or a nullable `record`.
 */
type NullOps<M extends QueryFieldMeta> = M extends { nullable: true }
  ? {
      /**
       * Matches rows whose value is `null`; the only null test, since `equalsTo(null)` is forbidden.
       *
       * @example
       * ```ts
       * query('Posts').where('summary', (w) => w.isNull())
       * ```
       */
      isNull(): WhereFieldAfterOp<M>;
    }
  : object;

/**
 * The relation existence pair `has`/`empty`, re-scoped to the target's fields.
 * A bare `has()` tests existence; a callback probes the target row; `empty()` is its negation.
 */
type HasOps<F extends Record<string, QueryFieldMeta>, M extends QueryFieldMeta> = {
  /**
   * Matches rows the relation reaches.
   * Bare `has()` tests it is set; a callback probes a related row, re-scoped to the target's fields.
   *
   * @example
   * ```ts
   * query('Posts').where('author', (w) => w.has())
   *
   * query('Posts').where('author', (w) => w.has((a) => a.where('name', 'Ada')))
   * ```
   */
  has(build?: (q: WhereBranch<F>) => WhereBranch<F>): WhereFieldAfterOp<M>;

  /**
   * Matches rows the relation does not reach: no linked row, or a null foreign key.
   *
   * @example
   * ```ts
   * query('Posts').where('tags', (w) => w.empty())
   * ```
   */
  empty(): WhereFieldAfterOp<M>;
};

/**
 * A composite child's own field table, or a permissive map when the shape is not statically known.
 */
type ChildFields<M extends QueryFieldMeta> = M extends {
  fields: infer F extends Record<string, QueryFieldMeta>;
}
  ? F
  : Record<string, QueryFieldMeta>;

/**
 * `has`/`empty`, admitted for the relation and composite kinds, re-scoped to the target's fields.
 */
type RelationalOps<M extends QueryFieldMeta> = M extends { record: infer T extends string }
  ? HasOps<FieldsOf<T>, M>
  : M extends { records: infer T extends string }
    ? HasOps<FieldsOf<T>, M>
    : M extends { child: 'one' | 'many' }
      ? HasOps<ChildFields<M>, M>
      : object;

/**
 * Every operator one field admits, composed by intersecting the applicable groups.
 * An inapplicable group contributes `object`, so asking for an unavailable operator is a type error.
 */
type FieldOps<M extends QueryFieldMeta> = EqualityOps<M> &
  InOps<M> &
  OrderingOps<M> &
  TextOps<M> &
  JsonOps<M> &
  NullOps<M> &
  RelationalOps<M>;

/**
 * The fresh state a where-callback opens on: every applicable operator, plus the `not` namespace.
 */
export type WhereFieldFresh<M extends QueryFieldMeta> = FieldOps<M> & {
  /**
   * Negates the next operator; `w.not.equalsTo(x)` matches rows whose value is not `x`.
   *
   * @example
   * ```ts
   * query('Posts').where('status', (w) => w.not.equalsTo('draft'))
   * ```
   */
  readonly not: WhereFieldNegated<M>;
};

/**
 * The state inside `not`: the operators alone, so double negation and `not.or` cannot be written.
 */
export type WhereFieldNegated<M extends QueryFieldMeta> = FieldOps<M>;

/**
 * The state after one operator: the operators again, plus `not` and `or`.
 * A where-callback must return this, so an empty callback fails to compile.
 */
export type WhereFieldAfterOp<M extends QueryFieldMeta> = FieldOps<M> & {
  /**
   * Negates the next operator; `w.not.equalsTo(x)` matches rows whose value is not `x`.
   *
   * @example
   * ```ts
   * query('Posts').where('status', (w) => w.not.equalsTo('draft'))
   * ```
   */
  readonly not: WhereFieldNegated<M>;

  /**
   * Starts an alternative comparison; the operators before and after `or` are ORed on this field.
   *
   * @example
   * ```ts
   * query('Posts').where('views', (w) => w.atLeast(100).or.equalsTo(0))
   * ```
   */
  readonly or: WhereFieldFresh<M>;
};

/**
 * The callback the full `where` form runs: it opens on a fresh field and must apply an operator.
 */
export type WhereBuild<M extends QueryFieldMeta> = (w: WhereFieldFresh<M>) => WhereFieldAfterOp<M>;

/**
 * The equality shorthand's value type: the field's scalar, or `never` where a scalar cannot compare.
 * `records` and composite fields have no shorthand (use `has`); `null` is never a value (use `isNull`).
 */
type EqValue<M extends QueryFieldMeta> = M extends { records: string }
  ? never
  : M extends { child: 'one' | 'many' }
    ? never
    : [ScalarOf<M>] extends [never]
      ? unknown
      : ScalarOf<M> extends string | number | boolean
        ? ScalarOf<M>
        : never;

/**
 * The `where` and `whereAny` filter methods over a field table `F`, each returning `Target`.
 */
interface WhereMethods<F extends Record<string, QueryFieldMeta>, Target> {
  /**
   * Filters by a field, matching its value for equality.
   * The value is typed to the field, so a wrong-typed value or `null` is a compile error.
   *
   * @example
   * ```ts
   * query('Posts').where('status', 'published')
   * ```
   */
  where<K extends keyof F & string>(field: K, value: EqValue<F[K]>): Target;

  /**
   * Filters by a field through a callback carrying exactly the operators that field admits.
   * `not` negates the next operator, `or` starts an alternative, `has`/`empty` reach into a relation.
   *
   * @example
   * ```ts
   * query('Posts').where('views', (w) => w.atLeast(100))
   *
   * query('Posts').where('author', (w) => w.has((a) => a.where('name', 'Ada')))
   * ```
   */
  where<K extends keyof F & string>(field: K, build: WhereBuild<F[K]>): Target;

  /**
   * Adds an OR group: a record matches when any branch matches.
   * Chaining `where` on one branch ANDs within it; the group ANDs onto the rest of the query.
   *
   * @example
   * ```ts
   * query('Posts').whereAny((q) => [q.where('status', 'published'), q.where('featured', true)])
   * ```
   */
  whereAny(build: (group: WhereGroup<F>) => WhereBranch<F>[]): Target;
}

/**
 * One OR branch under `whereAny`: chaining `where` on it ANDs into the same branch.
 */
export interface WhereBranch<F extends Record<string, QueryFieldMeta>> extends WhereMethods<
  F,
  WhereBranch<F>
> {}

/**
 * The factory a `whereAny` callback receives: each call opens a fresh OR branch.
 */
export interface WhereGroup<F extends Record<string, QueryFieldMeta>> extends WhereMethods<
  F,
  WhereBranch<F>
> {}

/**
 * Any top-level field name, the unit `select` and `pluck` address.
 */
export type SelectableField<C extends CollectionName> = keyof FieldsOf<C> & string;

/**
 * The relation fields `populate` accepts: `record` and `records` kinds only.
 */
export type PopulatableField<C extends CollectionName> = string extends keyof FieldsOf<C>
  ? string
  : {
      [K in keyof FieldsOf<C> & string]: FieldsOf<C>[K] extends
        | { record: string }
        | { records: string }
        ? K
        : never;
    }[keyof FieldsOf<C> & string];

/**
 * The fields `orderBy` accepts: every column-bearing field, `record` foreign keys included.
 */
export type OrderableField<C extends CollectionName> = string extends keyof FieldsOf<C>
  ? string
  : {
      [K in keyof FieldsOf<C> & string]: FieldsOf<C>[K] extends { scalar: unknown } ? K : never;
    }[keyof FieldsOf<C> & string];

/**
 * A populated field's value: a `record` becomes its target row or `null`, `records` an array of them.
 */
type PopulateSwap<C extends CollectionName, K> =
  FieldMetaOf<C, K> extends { record: infer T extends string }
    ? RecordOf<T> | null
    : FieldMetaOf<C, K> extends { records: infer T extends string }
      ? RecordOf<T>[]
      : never;

/**
 * A row shape with its populated fields swapped from `UUID`s to the hydrated target records.
 */
type SwapPopulated<Row, C extends CollectionName, P> = {
  [K in keyof Row]: K extends P ? PopulateSwap<C, K> : Row[K];
};

/**
 * One read row: the collection's record, narrowed by `select` (`S`) and swapped by `populate` (`P`).
 * With neither a select nor a populate it stays the named record, for clean hovers.
 */
export type QueryRow<C extends CollectionName, S = never, P = never> = [S] extends [never]
  ? [P] extends [never]
    ? RecordOf<C>
    : DeepPrettify<SwapPopulated<RecordOf<C>, C, P>>
  : DeepPrettify<SwapPopulated<Pick<RecordOf<C>, S & keyof RecordOf<C>>, C, P>>;

/**
 * One `pluck` value: the field's read type, swapped to the hydrated target when the field is populated.
 */
export type PluckValue<C extends CollectionName, F, P> = F extends P
  ? PopulateSwap<C, F>
  : F extends keyof RecordOf<C>
    ? RecordOf<C>[F]
    : unknown;

/**
 * One page of read rows with its totals.
 */
export interface PaginatedPage<C extends CollectionName, S = never, P = never> {
  /**
   * The rows on this page, in the query's order.
   */
  records: QueryRow<C, S, P>[];

  /**
   * The total matching-row count across every page.
   */
  total: number;

  /**
   * The page number read, one-based.
   */
  page: number;

  /**
   * The page size read.
   */
  perPage: number;

  /**
   * The number of the last page, `0` when nothing matches.
   */
  lastPage: number;
}

/**
 * The refinements every state offers; each returns a read-only query for the rest of the chain.
 */
interface Refinements<C extends CollectionName, S, P> {
  /**
   * Narrows the read to the named fields, accumulating across calls.
   * The returned rows carry only the selected fields.
   *
   * @example
   * ```ts
   * const rows = await query('Posts').select('title', 'views').findMany()
   * ```
   */
  select<F extends SelectableField<C>>(...fields: F[]): ReadOnlyQuery<C, S | F, P>;

  /**
   * Swaps a `record` or `records` field from its `UUID`s to the full target records, one level deep.
   * Populated rows are shared across the parents that link them, so do not mutate them.
   *
   * @example
   * ```ts
   * const rows = await query('Posts').populate('author').findMany()
   * const author = rows[0].author // the full author record, or null
   * ```
   */
  populate<F extends PopulatableField<C>>(...fields: F[]): ReadOnlyQuery<C, S, P | F>;

  /**
   * Adds a sort key, stacking after the keys already set; call it again for a tiebreaker.
   * Ties always resolve by `UUID` last, so pagination never reorders rows between pages.
   *
   * @example
   * ```ts
   * query('Posts').orderBy('publishedAt', 'desc').orderBy('title')
   * ```
   */
  orderBy(field: OrderableField<C>, direction?: OrderDirection): ReadOnlyQuery<C, S, P>;

  /**
   * Caps the number of rows read, replacing any previous cap.
   *
   * @example
   * ```ts
   * query('Posts').orderBy('publishedAt', 'desc').limit(10)
   * ```
   */
  limit(count: number): ReadOnlyQuery<C, S, P>;

  /**
   * Skips the given number of rows, replacing any previous offset.
   *
   * @example
   * ```ts
   * query('Posts').orderBy('publishedAt', 'desc').limit(10).offset(20)
   * ```
   */
  offset(count: number): ReadOnlyQuery<C, S, P>;
}

/**
 * The read terminals every state offers, each typed by the current select and populate.
 */
interface Terminals<C extends CollectionName, S, P> {
  /**
   * Reads every matching record as a full object, in the query's order.
   *
   * @example
   * ```ts
   * const posts = await query('Posts').where('status', 'published').findMany()
   * ```
   */
  findMany(): Promise<QueryRow<C, S, P>[]>;

  /**
   * Reads the first matching record, or `undefined` when none match.
   *
   * @example
   * ```ts
   * const post = await query('Posts').where('slug', 'hello-world').findFirst()
   * ```
   */
  findFirst(): Promise<QueryRow<C, S, P> | undefined>;

  /**
   * Counts every matching record, ignoring ordering and the row window.
   *
   * @example
   * ```ts
   * const total = await query('Posts').where('status', 'published').count()
   * ```
   */
  count(): Promise<number>;

  /**
   * Whether any record matches.
   *
   * @example
   * ```ts
   * const any = await query('Posts').where('featured', true).exists()
   * ```
   */
  exists(): Promise<boolean>;

  /**
   * Reads one page of records with its totals, the page number one-based.
   *
   * @example
   * ```ts
   * const page = await query('Posts').orderBy('publishedAt', 'desc').paginate(1, 20)
   * ```
   */
  paginate(page: number, perPage: number): Promise<PaginatedPage<C, S, P>>;

  /**
   * Reads one field's value from every matching record, in the query's order.
   * A populated relation field returns the hydrated records, exactly as a full read would.
   *
   * @example
   * ```ts
   * const titles = await query('Posts').pluck('title')
   * ```
   */
  pluck<F extends SelectableField<C>>(field: F): Promise<PluckValue<C, F, P>[]>;
}

/**
 * The `limits` override, present on every state and returning that same state.
 */
interface Limitable<Self> {
  /**
   * Overrides the wire limits for this builder, merging per key so the last value for a key wins.
   * These gate the untrusted wire path; the fluent path is trusted and never limit-checked.
   *
   * @example
   * ```ts
   * query('Posts').limits({ maxSelect: 50 })
   * ```
   */
  limits(overrides: Partial<QueryLimits>): Self;
}

/**
 * A create's result: the new record, or the field failures keyed by dot-path.
 */
export type CreateResult<T> = { ok: true; record: T } | { ok: false; errors: FieldErrors };

/**
 * An update's result: the matched records re-read in their final state, or the field failures by dot-path.
 */
export type UpdateResult<T> = { ok: true; records: T } | { ok: false; errors: FieldErrors };

/**
 * The `use` join, present on every state and returning that same state.
 */
interface Joinable<Self> {
  /**
   * Joins an open transaction, so a write terminal runs inside it rather than opening its own.
   *
   * @example
   * ```ts
   * query('Posts').use(tx).create({ title: 'Hi' })
   * ```
   */
  use(tx: Transaction): Self;
}

/**
 * The create terminals, available before a filter narrows the query to a specific set of rows.
 */
interface WriteEntry<C extends CollectionName, S, P> {
  /**
   * Creates one record, returning it on success or the field failures on a validation error.
   * The whole write runs in one transaction; nothing persists when it returns a failure.
   *
   * @example
   * ```ts
   * const result = await query('Posts').create({ title: 'Hi' })
   * if (result.ok) result.record // the new post
   * ```
   */
  create(input: InsertInputOf<C>): Promise<CreateResult<QueryRow<C, S, P>>>;

  /**
   * Creates one record and returns it, throwing a `validationError` carrying the failures instead.
   *
   * @example
   * ```ts
   * const post = await query('Posts').createOrThrow({ title: 'Hi' })
   * ```
   */
  createOrThrow(input: InsertInputOf<C>): Promise<QueryRow<C, S, P>>;
}

/**
 * The update and delete terminals, available once a filter has narrowed the query to a set of rows.
 */
interface WriteMutations<C extends CollectionName, S, P> {
  /**
   * Updates every matching record, returning them re-read on success or the field failures on error.
   * Only provided fields change; the whole write runs in one transaction and persists nothing on failure.
   *
   * @example
   * ```ts
   * const result = await query('Posts').where('status', 'draft').update({ status: 'published' })
   * if (result.ok) result.records // every updated post
   * ```
   */
  update(input: UpdateInputOf<C>): Promise<UpdateResult<QueryRow<C, S, P>[]>>;

  /**
   * Updates every matching record and returns them re-read, throwing a `validationError` on failure instead.
   *
   * @example
   * ```ts
   * const posts = await query('Posts').where('status', 'draft').updateOrThrow({ status: 'published' })
   * ```
   */
  updateOrThrow(input: UpdateInputOf<C>): Promise<QueryRow<C, S, P>[]>;

  /**
   * Deletes every matching record and reports how many were removed.
   *
   * @example
   * ```ts
   * const { deleted } = await query('Posts').where('status', 'spam').delete()
   * ```
   */
  delete(): Promise<{ deleted: number }>;
}

/**
 * A query before any filter: reads, refinements, `create`, and the filters that move it to `ReadyQuery`.
 */
export interface PendingQuery<C extends CollectionName, S = never, P = never>
  extends
    WhereMethods<FieldsOf<C>, ReadyQuery<C, S, P>>,
    Refinements<C, S, P>,
    Terminals<C, S, P>,
    WriteEntry<C, S, P>,
    Limitable<PendingQuery<C, S, P>>,
    Joinable<PendingQuery<C, S, P>> {}

/**
 * A query with a filter in place: reads, refinements, `update`/`delete`, and further filters that keep it here.
 */
export interface ReadyQuery<C extends CollectionName, S = never, P = never>
  extends
    WhereMethods<FieldsOf<C>, ReadyQuery<C, S, P>>,
    Refinements<C, S, P>,
    Terminals<C, S, P>,
    WriteMutations<C, S, P>,
    Limitable<ReadyQuery<C, S, P>>,
    Joinable<ReadyQuery<C, S, P>> {}

/**
 * A read-only query: one refinement stripped the write terminals for the rest of the chain.
 * Filtering still composes, but it can never return to a writable state.
 */
export interface ReadOnlyQuery<C extends CollectionName, S = never, P = never>
  extends
    WhereMethods<FieldsOf<C>, ReadOnlyQuery<C, S, P>>,
    Refinements<C, S, P>,
    Terminals<C, S, P>,
    Limitable<ReadOnlyQuery<C, S, P>>,
    Joinable<ReadOnlyQuery<C, S, P>> {}

/**
 * The typed builder a `query(collection)` opens on.
 */
export type QueryBuilder<C extends CollectionName> = PendingQuery<C>;

/**
 * The typed query entry: narrows the collection name and the whole chain that follows it.
 */
export type Query = <C extends CollectionName>(collection: C) => QueryBuilder<C>;

/**
 * Compile-time assertion that `A` is assignable to `B`; a mismatch is a type error at the use site.
 */
type Assert<A extends B, B> = A;

/**
 * The compile-time parity contract: a typed state's method names are all names of the untyped surface.
 * A typed view can therefore never name a method the one runtime class does not implement.
 * Each `Assert` checks its constraint where it is written, so a drift is a compile error here.
 */
export type QueryStateParity = [
  Assert<keyof PendingQuery<CollectionName>, keyof UntypedQueryBuilder>,
  Assert<keyof ReadyQuery<CollectionName>, keyof UntypedQueryBuilder>,
  Assert<keyof ReadOnlyQuery<CollectionName>, keyof UntypedQueryBuilder>,
];
