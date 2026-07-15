import type { SearchParamValue } from '../search-params/coerce-token.ts';
import type { ConditionNode } from './operators.ts';

import { isNull } from '../is/is-null.ts';

type LeafNode = Extract<ConditionNode, { negated: boolean }>;

function assign(
  obj: { [key: string]: SearchParamValue },
  key: string,
  value: SearchParamValue,
): void {
  Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true });
}

function joinField(path: readonly string[]): string {
  let out = '';
  let index = 0;
  if (path[index] === '/') {
    out = '/';
    index++;
  }
  while (path[index] === '..') {
    out += '../';
    index++;
  }
  return out + path.slice(index).join('.');
}

function entryOf(node: LeafNode): SearchParamValue {
  if (node.kind === 'compare' && node.op === 'equalsTo' && !node.negated) {
    return node.value as SearchParamValue;
  }
  const entry: { [key: string]: SearchParamValue } =
    node.kind === 'empty'
      ? { empty: true }
      : node.kind === 'has'
        ? { has: isNull(node.condition) ? true : serializeCondition(node.condition) }
        : node.op === 'isNull'
          ? { isNull: true }
          : { [node.op]: node.value as SearchParamValue };
  return node.negated ? { not: entry } : entry;
}

/**
 * Serializes a condition AST into its canonical object form, the exact inverse of `parseCondition`:
 * parsing the output yields a deep-equal AST for every normalized node.
 * An un-negated `equalsTo` emits the scalar shorthand; a negated leaf wraps its entry in `not`.
 * An `and` node merges children into one object when each child claims one distinct top-level key.
 * Otherwise it emits `{ and: [...] }`; an `or` node always emits `{ or: [...] }`.
 * Paths re-join: a leading `/` segment prefixes, `..` segments become `../`, the rest dots.
 *
 * @example
 * ```ts
 * serializeCondition({
 *   kind: 'compare',
 *   path: ['views'],
 *   op: 'atLeast',
 *   value: 100,
 *   negated: true,
 * })
 * // -> { views: { not: { atLeast: 100 } } }
 * ```
 */
export function serializeCondition(node: ConditionNode): { [key: string]: SearchParamValue } {
  if (node.kind === 'or') return { or: node.nodes.map((child) => serializeCondition(child)) };
  if (node.kind === 'and') {
    const groups = node.nodes.map((child) => serializeCondition(child));
    const keys = groups.map((group) => Object.keys(group));
    const mergeable =
      keys.every((own) => own.length === 1) &&
      new Set(keys.map((own) => own[0])).size === groups.length;
    if (!mergeable) return { and: groups };
    const out: { [key: string]: SearchParamValue } = {};
    groups.forEach((group, index) => assign(out, keys[index][0], group[keys[index][0]]));
    return out;
  }
  const out: { [key: string]: SearchParamValue } = {};
  assign(out, joinField(node.path), entryOf(node));
  return out;
}
