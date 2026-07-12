import type { CompareOperator, ConditionNode } from './operators.ts';

import { isArray } from '../is/is-array.ts';
import { isNull } from '../is/is-null.ts';
import { isNullish } from '../is/is-nullish.ts';
import { isNumber } from '../is/is-number.ts';
import { isObject } from '../is/is-object.ts';
import { isPlainObject } from '../is/is-plain-object.ts';
import { isString } from '../is/is-string.ts';
import { hasKey } from '../object/has-key.ts';

type OrderingOperator = 'greaterThan' | 'atLeast' | 'lessThan' | 'atMost';

function ordinal<T extends number | string>(op: OrderingOperator, left: T, right: T): boolean {
  if (op === 'greaterThan') return left > right;
  if (op === 'atLeast') return left >= right;
  if (op === 'lessThan') return left < right;
  return left <= right;
}

/**
 * Matches `text` against a SQL `LIKE` pattern, `%` spanning any run and `_` one character.
 * Case-insensitive, and compares by Unicode code point so `_` matches one astral character.
 * Uses a greedy two-pointer with `%` backtracking, not a regex.
 * A regex with alternating `%` runs could backtrack catastrophically on hostile input.
 */
function likeMatch(text: string, pattern: string): boolean {
  const chars = [...text.toLowerCase()];
  const parts = [...pattern.toLowerCase()];
  let ti = 0;
  let pi = 0;
  let star = -1;
  let mark = 0;
  while (ti < chars.length) {
    if (pi < parts.length && (parts[pi] === '_' || parts[pi] === chars[ti])) {
      ti++;
      pi++;
    } else if (pi < parts.length && parts[pi] === '%') {
      star = pi++;
      mark = ti;
    } else if (star !== -1) {
      pi = star + 1;
      ti = ++mark;
    } else {
      return false;
    }
  }
  while (pi < parts.length && parts[pi] === '%') pi++;
  return pi === parts.length;
}

function readPath(value: unknown, path: readonly string[]): unknown {
  let cursor: unknown = value;
  for (const segment of path) {
    if (!isPlainObject(cursor)) return undefined;
    cursor = hasKey(cursor, segment) ? cursor[segment] : undefined;
  }
  return cursor;
}

function compareValue(op: CompareOperator, resolved: unknown, value: unknown): boolean {
  switch (op) {
    case 'equalsTo':
      return resolved === value;
    case 'in':
      return isArray(value) && value.includes(resolved);
    case 'greaterThan':
    case 'atLeast':
    case 'lessThan':
    case 'atMost':
      if (isNumber(resolved) && isNumber(value)) return ordinal(op, resolved, value);
      if (isString(resolved) && isString(value)) return ordinal(op, resolved, value);
      return false;
    case 'contains':
    case 'startsWith':
    case 'endsWith': {
      if (!isString(resolved) || !isString(value)) return false;
      const haystack = resolved.toLowerCase();
      const needle = value.toLowerCase();
      if (op === 'contains') return haystack.includes(needle);
      return op === 'startsWith' ? haystack.startsWith(needle) : haystack.endsWith(needle);
    }
    case 'like':
      return isString(resolved) && isString(value) && likeMatch(resolved, value);
    case 'isNull':
      return isNull(resolved);
    case 'includes':
      return isArray(resolved) && resolved.includes(value);
    case 'includesAll':
      return isArray(resolved) && isArray(value) && value.every((item) => resolved.includes(item));
    case 'includesAny':
      return isArray(resolved) && isArray(value) && value.some((item) => resolved.includes(item));
  }
}

function hasMatch(condition: ConditionNode | null, value: unknown): boolean {
  if (isNull(condition)) {
    return !isNullish(value) && (!isArray(value) || value.length > 0);
  }
  if (isArray(value)) {
    return value.some((item) => evaluateCondition(condition, (path) => readPath(item, path)));
  }
  if (isObject(value)) return evaluateCondition(condition, (path) => readPath(value, path));
  return false;
}

/**
 * Evaluates a condition AST against values supplied by `resolve`.
 * Scope rules stay outside: `resolve(path)` maps a field path to its value.
 * Misuse is inert: a comparison over mismatched types or wrong shapes is `false`, never a throw.
 * A leaf's `negated` flag flips its result; `and` over no nodes is `true`, `or` over none `false`.
 *
 * Text operators (`contains`, `startsWith`, `endsWith`, `like`) match case-insensitively.
 * `like` treats `%` as any run and `_` as one character.
 * A bare `has` wants a non-null value that is not an empty array.
 * A nested `has` condition matches an array when some item satisfies it.
 * A non-null object matches when the object itself does.
 * Inner paths descend by plain own properties.
 * `empty` is `true` for an empty array or `null`.
 *
 * @example
 * ```ts
 * const node = {
 *   kind: 'compare', path: ['views'], op: 'atLeast', value: 100, negated: false,
 * } as const
 *
 * evaluateCondition(node, () => 120)  // -> true
 * evaluateCondition(node, () => 'no') // -> false
 * ```
 */
export function evaluateCondition(
  node: ConditionNode,
  resolve: (path: readonly string[]) => unknown,
): boolean {
  switch (node.kind) {
    case 'and':
      return node.nodes.every((child) => evaluateCondition(child, resolve));
    case 'or':
      return node.nodes.some((child) => evaluateCondition(child, resolve));
    case 'compare': {
      const result = compareValue(node.op, resolve(node.path), node.value);
      return node.negated ? !result : result;
    }
    case 'has': {
      const result = hasMatch(node.condition, resolve(node.path));
      return node.negated ? !result : result;
    }
    case 'empty': {
      const value = resolve(node.path);
      const result = isArray(value) ? value.length === 0 : isNull(value);
      return node.negated ? !result : result;
    }
  }
}
