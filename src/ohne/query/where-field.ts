import { isArray, isFunction, isString } from '../../utils/index.ts';

/**
 * A comparison object one operator-callback builds: operator keys, plus optional `not`/`or`.
 */
type Comparison = Record<string, unknown>;

/**
 * A where object a `has` sub-query builds: field keys and logical groups.
 */
type WhereObject = Record<string, unknown>;

/**
 * The runtime operator collector a `where(field, (w) => ...)` callback drives.
 * Every operator records its key on the current comparison and returns the collector to chain on.
 * `has` takes a scope callback, or a block type name ahead of one.
 * The name lowers to the scope's bare `block` equality, the discriminated form the blocks grammar requires.
 * `not` opens a negated comparison; `or` opens a fresh alternative folded into the comparison's `or`.
 * The type-level state machine in `builder.ts` gates which of these are reachable; the runtime is uniform.
 */
interface WhereFieldCollector {
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
  readonly not: WhereFieldCollector;
  readonly or: WhereFieldCollector;
}

/**
 * The callback shape `buildComparison` runs, the runtime twin of `builder.ts`'s `WhereBuild`.
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
  if (isFunction<WhereFieldBuild>(value)) return { [field]: buildComparison(value) };
  return { [field]: value };
}

/**
 * Runs an operator callback and returns the comparison object it built.
 */
function buildComparison(build: WhereFieldBuild): Comparison {
  const root: Comparison = {};
  build(collector(root, root));
  return root;
}

/**
 * Builds one operator collector over `target`, drawing `or` alternatives from the shared `root`.
 */
function collector(target: Comparison, root: Comparison): WhereFieldCollector {
  const set = (op: string, value: unknown): WhereFieldCollector => {
    target[op] = value;
    return self;
  };
  const self: WhereFieldCollector = {
    equalsTo: (value) => set('equalsTo', value),
    in: (values) => set('in', values),
    greaterThan: (value) => set('greaterThan', value),
    atLeast: (value) => set('atLeast', value),
    lessThan: (value) => set('lessThan', value),
    atMost: (value) => set('atMost', value),
    contains: (value) => set('contains', value),
    startsWith: (value) => set('startsWith', value),
    endsWith: (value) => set('endsWith', value),
    like: (value) => set('like', value),
    includes: (value) => set('includes', value),
    includesAll: (values) => set('includesAll', values),
    includesAny: (values) => set('includesAny', values),
    isNull: () => set('isNull', true),
    empty: () => set('empty', true),
    has: (blockOrBuild, build) => set('has', lowerHas(blockOrBuild, build)),
    get not() {
      const negated: Comparison = {};
      target.not = negated;
      return collector(negated, root);
    },
    get or() {
      const alternative: Comparison = {};
      const existing = root.or;
      if (isArray<Comparison[]>(existing)) existing.push(alternative);
      else root.or = [alternative];
      return collector(alternative, root);
    },
  };
  return self;
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
