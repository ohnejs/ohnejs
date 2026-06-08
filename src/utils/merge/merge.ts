import { unique } from '../array/unique.ts';
import { isArray } from '../is/is-array.ts';
import { isMap } from '../is/is-map.ts';
import { isPlainObject } from '../is/is-plain-object.ts';
import { isSet } from '../is/is-set.ts';
import { isUndefined } from '../is/is-undefined.ts';

interface MergeOptions {
  /**
   * Deduplicate concatenated arrays via `unique`.
   * Applies at every depth, not just the top level.
   *
   * @default
   * false
   */
  dedupe?: boolean;

  /**
   * Recursively merge `Map` values on shared keys instead of letting `source` replace.
   *
   * @default
   * false
   */
  deep?: boolean;
}

/**
 * Deeply merges `source` into `target`, returning a new value; `source` wins at every leaf.
 *
 * - Plain objects merge recursively; `undefined` source values and symbol keys are skipped.
 * - Arrays concat; pass `{ dedupe: true }` to drop duplicates via `unique`.
 * - `Set`s union; `Map`s let `source` win per key, or recurse into values with `{ deep: true }`.
 * - Non-plain values (`Date`, `RegExp`, class instances, ...) and mismatched kinds replace wholesale.
 *
 * Neither input is mutated; nested collections are cloned on the merged path.
 * `__proto__`, `constructor`, and `prototype` keys in `source` are dropped to prevent prototype pollution.
 *
 * @example
 * ```ts
 * merge({ a: 1, b: { c: 1, d: 2 } }, { b: { d: 3, e: 4 } })
 * // -> { a: 1, b: { c: 1, d: 3, e: 4 } }
 *
 * merge({ tags: ['a', 'b'] }, { tags: ['b', 'c'] })
 * // -> { tags: ['a', 'b', 'b', 'c'] }
 *
 * merge({ tags: ['a', 'b'] }, { tags: ['b', 'c'] }, { dedupe: true })
 * // -> { tags: ['a', 'b', 'c'] }
 *
 * merge(new Set([1, 2]), new Set([2, 3]))
 * // -> Set { 1, 2, 3 }
 *
 * merge(new Map([['k', 1]]), new Map([['k', 2]]))
 * // -> Map { 'k' => 2 }
 * ```
 */
export function merge<T>(target: T, source: undefined, options?: MergeOptions): T;
export function merge<T>(target: undefined, source: T, options?: MergeOptions): T;
export function merge<A, B>(target: A[], source: B[], options?: MergeOptions): (A | B)[];
export function merge<A, B>(target: Set<A>, source: Set<B>, options?: MergeOptions): Set<A | B>;
export function merge<K1, V1, K2, V2>(
  target: Map<K1, V1>,
  source: Map<K2, V2>,
  options?: MergeOptions,
): Map<K1 | K2, V1 | V2>;
export function merge<A extends object, B extends object>(
  target: A,
  source: B,
  options?: MergeOptions,
): A & B;
export function merge<A, B>(target: A, source: B, options?: MergeOptions): B;
export function merge(target: unknown, source: unknown, options: MergeOptions = {}): unknown {
  if (isUndefined(source)) return target;
  if (isUndefined(target)) return source;

  if (isArray(target) && isArray(source)) {
    const combined = [...target, ...source];
    return options.dedupe ? unique(combined) : combined;
  }

  if (isSet(target) && isSet(source)) {
    return new Set([...target, ...source]);
  }

  if (isMap(target) && isMap(source)) {
    const result = new Map<unknown, unknown>(target);
    for (const [k, v] of source) {
      result.set(k, options.deep && result.has(k) ? merge(result.get(k), v, options) : v);
    }
    return result;
  }

  if (!isPlainObject(target) || !isPlainObject(source)) return source;

  const result: Record<string, unknown> = { ...target };
  for (const key of Object.keys(source)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const sv = source[key];
    if (isUndefined(sv)) continue;
    const tv = result[key];
    const mergeable =
      (isPlainObject(tv) && isPlainObject(sv)) ||
      (isArray(tv) && isArray(sv)) ||
      (isSet(tv) && isSet(sv)) ||
      (isMap(tv) && isMap(sv));
    result[key] = mergeable ? merge(tv, sv, options) : sv;
  }
  return result;
}
