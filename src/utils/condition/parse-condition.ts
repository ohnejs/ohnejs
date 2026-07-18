import { isArray } from '../is/is-array.ts';
import { isBoolean } from '../is/is-boolean.ts';
import { isNull } from '../is/is-null.ts';
import { isNumber } from '../is/is-number.ts';
import { isPlainObject } from '../is/is-plain-object.ts';
import { isString } from '../is/is-string.ts';
import { isUndefined } from '../is/is-undefined.ts';
import { hasKey } from '../object/has-key.ts';
import { compareOperators, type CompareOperator, type ConditionNode } from './operators.ts';

/**
 * Options for `parseCondition`.
 */
export interface ParseConditionOptions {
  /**
   * Maximum nesting depth of grouped conditions (`and`, `or`, `not`, `has`, comparison `or`).
   * Exceeding it fails with `tooDeep`, so hostile depth bombs never overflow the stack.
   *
   * @default
   * 32
   */
  maxDepth?: number;
}

/**
 * A structured parse failure.
 */
export interface ConditionError {
  /**
   * The failure category.
   * `invalidShape`: a value or key where the grammar expects another form.
   * `unknownOperator`: a comparison key outside the operator vocabulary.
   * `invalidValue`: an operator value of the wrong JSON kind.
   * `nullEquality`: `null` as a field entry, `equalsTo` value, or `in` element - use `isNull`.
   * `tooDeep`: nesting past `maxDepth`.
   */
  code: 'invalidShape' | 'unknownOperator' | 'invalidValue' | 'nullEquality' | 'tooDeep';

  /**
   * Dot path locating the failure in the input object: `views.atLeast`, `or[1].status`.
   * The empty string is the root.
   */
  path: string;

  /**
   * The offending key, when one exists.
   */
  key?: string;
}

/**
 * The outcome of `parseCondition`.
 * `node` is present only when `ok` is `true`; otherwise `error` locates the first failure.
 */
export type ConditionResult =
  | { ok: true; node: ConditionNode }
  | { ok: false; error: ConditionError };

class Failure {
  readonly error: ConditionError;

  constructor(error: ConditionError) {
    this.error = error;
  }
}

function fail(code: ConditionError['code'], path: string, key?: string): never {
  throw new Failure(isUndefined(key) ? { code, path } : { code, path, key });
}

function join(path: string, key: string): string {
  return path === '' ? key : `${path}.${key}`;
}

function isScalar(value: unknown): value is string | number | boolean {
  return isString(value) || isNumber(value) || isBoolean(value);
}

function isCompareOperator(key: string): key is CompareOperator {
  return hasKey(compareOperators, key);
}

function fieldPath(key: string, path: string): string[] {
  const segments: string[] = [];
  let rest = key;
  if (rest.startsWith('/')) {
    segments.push('/');
    rest = rest.slice(1);
  }
  while (rest.startsWith('../')) {
    segments.push('..');
    rest = rest.slice(3);
  }
  if (rest === '') fail('invalidShape', path, key);
  for (const segment of rest.split('.')) {
    if (segment === '') fail('invalidShape', path, key);
    segments.push(segment);
  }
  return segments;
}

function negate(node: ConditionNode): ConditionNode {
  if (node.kind === 'and') return { kind: 'or', nodes: node.nodes.map(negate) };
  if (node.kind === 'or') return { kind: 'and', nodes: node.nodes.map(negate) };
  return { ...node, negated: !node.negated };
}

function compareLeaf(
  op: CompareOperator,
  value: unknown,
  field: readonly string[],
  path: string,
): ConditionNode {
  const kind = compareOperators[op].value;
  if (kind === 'none') {
    if (value !== true) fail('invalidValue', path, op);
    return { kind: 'compare', path: field, op, negated: false };
  }
  if (op === 'equalsTo' && isNull(value)) fail('nullEquality', path, op);
  if (kind === 'scalar[]') {
    if (!isArray(value)) fail('invalidValue', path, op);
    for (const item of value) {
      if (op === 'in' && isNull(item)) fail('nullEquality', path, op);
      if (!isScalar(item)) fail('invalidValue', path, op);
    }
    return { kind: 'compare', path: field, op, value: [...value], negated: false };
  }
  if (
    (kind === 'scalar' && !isScalar(value)) ||
    (kind === 'ordinal' && !isString(value) && !isNumber(value)) ||
    (kind === 'string' && !isString(value))
  ) {
    fail('invalidValue', path, op);
  }
  return { kind: 'compare', path: field, op, value, negated: false };
}

function parseComparison(
  input: unknown,
  field: readonly string[],
  path: string,
  depth: number,
  maxDepth: number,
): ConditionNode {
  if (depth > maxDepth) fail('tooDeep', path);
  if (!isPlainObject(input)) fail('invalidShape', path);
  const parts: ConditionNode[] = [];
  const alternatives: ConditionNode[] = [];
  let disjoined = false;
  for (const key of Object.keys(input)) {
    const value = input[key];
    const keyPath = join(path, key);
    if (key === 'not') {
      parts.push(negate(parseComparison(value, field, keyPath, depth + 1, maxDepth)));
    } else if (key === 'or') {
      if (!isArray(value)) fail('invalidShape', keyPath, key);
      disjoined = true;
      for (const [index, alternative] of value.entries()) {
        alternatives.push(
          parseComparison(alternative, field, `${keyPath}[${index}]`, depth + 1, maxDepth),
        );
      }
    } else if (key === 'has') {
      if (value === true) {
        parts.push({ kind: 'has', path: field, condition: null, negated: false });
      } else if (isPlainObject(value)) {
        parts.push({
          kind: 'has',
          path: field,
          condition: parseWhere(value, keyPath, depth + 1, maxDepth),
          negated: false,
        });
      } else {
        fail('invalidValue', keyPath, key);
      }
    } else if (key === 'empty') {
      if (value !== true) fail('invalidValue', keyPath, key);
      parts.push({ kind: 'empty', path: field, negated: false });
    } else if (isCompareOperator(key)) {
      parts.push(compareLeaf(key, value, field, keyPath));
    } else {
      fail('unknownOperator', keyPath, key);
    }
  }
  if (!disjoined) return parts.length === 1 ? parts[0] : { kind: 'and', nodes: parts };
  const branches =
    parts.length === 0
      ? alternatives
      : [parts.length === 1 ? parts[0] : ({ kind: 'and', nodes: parts } as const), ...alternatives];
  return branches.length === 1 ? branches[0] : { kind: 'or', nodes: branches };
}

function parseWhere(input: unknown, path: string, depth: number, maxDepth: number): ConditionNode {
  if (depth > maxDepth) fail('tooDeep', path);
  if (!isPlainObject(input)) fail('invalidShape', path);
  const parts: ConditionNode[] = [];
  for (const key of Object.keys(input)) {
    const value = input[key];
    const keyPath = join(path, key);
    if (key === 'and' || key === 'or') {
      if (!isArray(value)) fail('invalidShape', keyPath, key);
      const nodes = value.map((group, index) =>
        parseWhere(group, `${keyPath}[${index}]`, depth + 1, maxDepth),
      );
      parts.push(nodes.length === 1 ? nodes[0] : { kind: key, nodes });
    } else if (key === 'not') {
      parts.push(negate(parseWhere(value, keyPath, depth + 1, maxDepth)));
    } else {
      const field = fieldPath(key, keyPath);
      if (isNull(value)) {
        fail('nullEquality', keyPath, key);
      } else if (isScalar(value)) {
        parts.push({ kind: 'compare', path: field, op: 'equalsTo', value, negated: false });
      } else if (isPlainObject(value)) {
        parts.push(parseComparison(value, field, keyPath, depth, maxDepth));
      } else {
        fail('invalidShape', keyPath, key);
      }
    }
  }
  return parts.length === 1 ? parts[0] : { kind: 'and', nodes: parts };
}

/**
 * Parses the condition object form into the normalized `ConditionNode` AST.
 * Validates shape only - operator names, arity, value JSON-kinds.
 * Field applicability is the framework's job.
 * Sibling field keys AND; `and`/`or` take arrays of groups, `not` one group; a comparison's `or`
 * ORs the AND of its sibling operators against each alternative.
 * Negation folds to the leaves: De Morgan over groups, double negation cancels, no `not` node.
 * Groups with one child collapse to that child; empty groups survive as `and([])` / `or([])`.
 * An array operator value is copied, so mutating the caller's array never changes the parsed node.
 *
 * Untrusted input never throws: failures return a structured `ConditionError`.
 * A literal `__proto__` key is an ordinary field name.
 * Nothing user-controlled is assigned into plain objects, so parsing cannot pollute a prototype.
 *
 * @example
 * ```ts
 * parseCondition({ status: 'published' })
 * // -> { ok: true, node: { kind: 'compare', path: ['status'], op: 'equalsTo',
 * //      value: 'published', negated: false } }
 *
 * parseCondition({ views: null })
 * // -> { ok: false, error: { code: 'nullEquality', path: 'views', key: 'views' } }
 * ```
 */
export function parseCondition(
  input: unknown,
  options: ParseConditionOptions = {},
): ConditionResult {
  const maxDepth = options.maxDepth ?? 32;
  try {
    return { ok: true, node: parseWhere(input, '', 1, maxDepth) };
  } catch (error) {
    if (error instanceof Failure) return { ok: false, error: error.error };
    throw error;
  }
}
