/**
 * The closed set of comparison operators the condition grammar speaks.
 * Wire spelling, builder method name, and object key are one spelling.
 * `has` and `empty` are `ConditionNode` kinds, not compare operators.
 * Every operator except `isNull` treats a `NULL` operand as no match, negated or not, as SQL does.
 */
export type CompareOperator =
  | 'equalsTo'
  | 'in'
  | 'greaterThan'
  | 'atLeast'
  | 'lessThan'
  | 'atMost'
  | 'contains'
  | 'startsWith'
  | 'endsWith'
  | 'like'
  | 'isNull'
  | 'includes'
  | 'includesAll'
  | 'includesAny';

/**
 * The JSON kind a compare operator's value must have.
 * `scalar` is a string, number, or boolean; `scalar[]` an array of scalars.
 * `ordinal` is a string or number; `string` a string; `none` no value (`isNull` takes literal `true`).
 */
export type OperatorValueKind = 'scalar' | 'scalar[]' | 'ordinal' | 'string' | 'none';

/**
 * Shape metadata for one compare operator.
 */
export interface OperatorSpec {
  /**
   * How many values the operator takes: `0` for `isNull`, `1` for every other operator.
   */
  arity: 0 | 1;

  /**
   * The JSON kind the operator's value must have.
   */
  value: OperatorValueKind;
}

/**
 * The operator vocabulary: arity and value kind per compare operator.
 * `parseCondition` validates shapes against it; per-field applicability is the consumer's job.
 *
 * @example
 * ```ts
 * compareOperators.isNull  // -> { arity: 0, value: 'none' }
 * compareOperators.atLeast // -> { arity: 1, value: 'ordinal' }
 * ```
 */
export const compareOperators: Readonly<Record<CompareOperator, OperatorSpec>> = {
  equalsTo: { arity: 1, value: 'scalar' },
  in: { arity: 1, value: 'scalar[]' },
  greaterThan: { arity: 1, value: 'ordinal' },
  atLeast: { arity: 1, value: 'ordinal' },
  lessThan: { arity: 1, value: 'ordinal' },
  atMost: { arity: 1, value: 'ordinal' },
  contains: { arity: 1, value: 'string' },
  startsWith: { arity: 1, value: 'string' },
  endsWith: { arity: 1, value: 'string' },
  like: { arity: 1, value: 'string' },
  isNull: { arity: 0, value: 'none' },
  includes: { arity: 1, value: 'scalar' },
  includesAll: { arity: 1, value: 'scalar[]' },
  includesAny: { arity: 1, value: 'scalar[]' },
};

/**
 * The normalized condition AST every consumer reads.
 * `compare`, `has`, and `empty` are leaves over a field `path`; `and` and `or` group nodes.
 * `path` is segments: a leading `/` segment anchors at the root, each `..` segment climbs one level.
 * No `not` node exists: parsing folds negation into the leaf `negated` flags (De Morgan).
 * A `has` with `condition: null` tests bare existence.
 * A compare carries `value` only when its operator takes one; an `isNull` leaf has no `value` key.
 */
export type ConditionNode =
  | {
      kind: 'compare';
      path: readonly string[];
      op: CompareOperator;
      value?: unknown;
      negated: boolean;
    }
  | { kind: 'has'; path: readonly string[]; condition: ConditionNode | null; negated: boolean }
  | { kind: 'empty'; path: readonly string[]; negated: boolean }
  | { kind: 'and'; nodes: readonly ConditionNode[] }
  | { kind: 'or'; nodes: readonly ConditionNode[] };
