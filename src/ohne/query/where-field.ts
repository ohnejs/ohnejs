import { isFunction, isString } from '../../utils/index.ts';

/**
 * One comparison object: operator keys, each at most once, plus an optional `not`.
 */
type Comparison = Record<string, unknown>;

/**
 * A where object a `has` sub-query builds: field keys and logical groups.
 */
type WhereObject = Record<string, unknown>;

/**
 * The runtime operators a `where(field, (w) => ...)` callback drives.
 * Every operator ANDs its term into the current alternative and returns the collector to chain on.
 * `has` takes a scope callback, or a block type name ahead of one.
 * The name lowers to the scope's bare `block` equality, the discriminated form the blocks grammar requires.
 */
interface WhereFieldOperators {
  equalsTo(value: unknown): WhereFieldCollector;
  in(values: unknown): WhereFieldCollector;
  greaterThan(value: unknown): WhereFieldCollector;
  atLeast(value: unknown): WhereFieldCollector;
  lessThan(value: unknown): WhereFieldCollector;
  atMost(value: unknown): WhereFieldCollector;
  contains(value: unknown): WhereFieldCollector;
  startsWith(value: unknown): WhereFieldCollector;
  endsWith(value: unknown): WhereFieldCollector;
  like(value: unknown): WhereFieldCollector;
  includes(value: unknown): WhereFieldCollector;
  includesAll(values: unknown): WhereFieldCollector;
  includesAny(values: unknown): WhereFieldCollector;
  isNull(): WhereFieldCollector;
  empty(): WhereFieldCollector;
  has(blockOrBuild?: string | WhereScopeBuild, build?: WhereScopeBuild): WhereFieldCollector;
}

/**
 * The runtime collector: the operators, `not` to negate the next one, `or` to open an alternative.
 * The type-level state machine in `builder.ts` gates which of these are reachable; the runtime is uniform.
 */
interface WhereFieldCollector extends WhereFieldOperators {
  readonly not: WhereFieldOperators;
  readonly or: WhereFieldCollector;
}

/**
 * The callback shape `lowerField` runs, the runtime twin of `builder.ts`'s `WhereBuild`.
 */
type WhereFieldBuild = (w: WhereFieldCollector) => unknown;

/**
 * A `has` sub-query collector: it accumulates field conditions into one target-scoped where object.
 */
interface WhereScope {
  where(field: string, value: unknown): WhereScope;
  whereAny(build: WhereScopeGroupBuild): WhereScope;
}

/**
 * The factory a sub-query `whereAny` receives: each call opens a fresh branch scope.
 */
interface WhereScopeGroup {
  where(field: string, value: unknown): WhereScope;
  whereAny(build: WhereScopeGroupBuild): WhereScope;
}

/**
 * The callback a sub-query `whereAny` runs, returning the branch scopes to OR together.
 */
type WhereScopeGroupBuild = (group: WhereScopeGroup) => WhereScope[];

/**
 * The internal scope object, its accumulated where readable through `toWhere`.
 */
interface ScopeState extends WhereScope {
  toWhere(): WhereObject;
}

/**
 * Lowers one fluent `where(field, value | build)` into the object grammar the parser already accepts.
 *
 * A plain value becomes the field's equality shorthand (`{ title: 'ohne' }`).
 * A callback builds the field's comparison (`{ views: { atLeast: 100 } }`).
 * An operator repeated within one alternative, `not` included, splits it into an `and` of comparisons.
 * Several `or` alternatives lower to an `or` of them.
 * The lowered object feeds the same parse-and-gate path the object and wire forms use.
 * The fluent surface therefore has no compiler of its own.
 *
 * @example
 * ```ts
 * lowerField('title', 'ohne')             // -> { title: 'ohne' }
 * lowerField('views', (w) => w.atLeast(1)) // -> { views: { atLeast: 1 } }
 * ```
 */
export function lowerField(field: string, value: unknown): WhereObject {
  if (!isFunction<WhereFieldBuild>(value)) return { [field]: value };
  const conjunction = (comparisons: Comparison[]): WhereObject =>
    comparisons.length === 1
      ? { [field]: comparisons[0] }
      : { and: comparisons.map((comparison) => ({ [field]: comparison })) };
  const alternatives = collect(value);
  return alternatives.length === 1
    ? conjunction(alternatives[0])
    : { or: alternatives.map(conjunction) };
}

/**
 * Runs an operator callback and returns its `or` alternatives, each a list of comparisons to AND.
 * An operator merges into the last comparison unless that one already holds its key.
 * A negated operator hands back the outer collector, so `not` negates only the next operator.
 */
function collect(build: WhereFieldBuild): Comparison[][] {
  let comparisons: Comparison[] = [];
  const alternatives = [comparisons];
  const add = (op: string, value: unknown): WhereFieldCollector => {
    const last = comparisons.at(-1);
    if (last && !Object.hasOwn(last, op)) last[op] = value;
    else comparisons.push({ [op]: value });
    return self;
  };
  const self: WhereFieldCollector = {
    ...operators(add),
    get not() {
      return operators((op, value) => add('not', { [op]: value }));
    },
    get or() {
      comparisons = [];
      alternatives.push(comparisons);
      return self;
    },
  };
  build(self);
  return alternatives;
}

/**
 * Binds every operator to `add`, which records its key and value.
 */
function operators(add: (op: string, value: unknown) => WhereFieldCollector): WhereFieldOperators {
  return {
    equalsTo: (value) => add('equalsTo', value),
    in: (values) => add('in', values),
    greaterThan: (value) => add('greaterThan', value),
    atLeast: (value) => add('atLeast', value),
    lessThan: (value) => add('lessThan', value),
    atMost: (value) => add('atMost', value),
    contains: (value) => add('contains', value),
    startsWith: (value) => add('startsWith', value),
    endsWith: (value) => add('endsWith', value),
    like: (value) => add('like', value),
    includes: (value) => add('includes', value),
    includesAll: (values) => add('includesAll', values),
    includesAny: (values) => add('includesAny', values),
    isNull: () => add('isNull', true),
    empty: () => add('empty', true),
    has: (blockOrBuild, build) => add('has', lowerHas(blockOrBuild, build)),
  };
}

/**
 * Lowers a `has` call to its wire value: bare existence, a scope object, or a discriminated scope.
 * A block type name becomes the scope's bare `block` equality, beside the callback's conditions.
 */
function lowerHas(blockOrBuild?: string | WhereScopeBuild, build?: WhereScopeBuild): unknown {
  if (isString(blockOrBuild)) {
    return { block: blockOrBuild, ...(isFunction(build) ? runScope(build) : {}) };
  }
  return isFunction(blockOrBuild) ? runScope(blockOrBuild) : true;
}

/**
 * Runs a `has` sub-query callback and returns the target-scoped where object it built.
 */
function runScope(build: WhereScopeBuild): WhereObject {
  const state = scope();
  build(state);
  return state.toWhere();
}

/**
 * The callback a `has` receives, the runtime twin of a sub-scoped `WhereBranch` builder.
 */
type WhereScopeBuild = (q: WhereScope) => unknown;

/**
 * Builds one sub-query scope: `where` ANDs a field condition, `whereAny` ANDs an OR group.
 * Its accumulated conditions fold to a single where, or an `and` group when there is more than one.
 */
function scope(): ScopeState {
  const parts: WhereObject[] = [];
  const self: ScopeState = {
    where(field, value) {
      parts.push(lowerField(field, value));
      return self;
    },
    whereAny(build) {
      parts.push({ or: branches(build) });
      return self;
    },
    toWhere() {
      return parts.length === 1 ? (parts[0] as WhereObject) : { and: parts };
    },
  };
  return self;
}

/**
 * Runs a sub-query `whereAny` callback and folds its branches into an array of where objects.
 */
function branches(build: WhereScopeGroupBuild): WhereObject[] {
  const group: WhereScopeGroup = {
    where: (field, value) => scope().where(field, value),
    whereAny: (nested) => scope().whereAny(nested),
  };
  return build(group).map((branch) => (branch as ScopeState).toWhere());
}
