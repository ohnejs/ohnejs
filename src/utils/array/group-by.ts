/**
 * Groups items by the key returned from `keyFn`, preserving input order within each group.
 *
 * @example
 * ```ts
 * groupBy([1, 2, 3, 4], (n) => n % 2 === 0 ? 'even' : 'odd')
 * // -> { odd: [1, 3], even: [2, 4] }
 *
 * groupBy([{ r: 'a' }, { r: 'b' }, { r: 'a' }], (x) => x.r)
 * // -> { a: [{ r: 'a' }, { r: 'a' }], b: [{ r: 'b' }] }
 * ```
 */
export function groupBy<T, K extends PropertyKey>(
  array: readonly T[],
  keyFn: (item: T, index: number) => K,
): Partial<Record<K, T[]>> {
  const result: Partial<Record<K, T[]>> = {};
  for (let i = 0; i < array.length; i++) {
    const item = array[i] as T;
    const key = keyFn(item, i);
    (result[key] ??= []).push(item);
  }
  return result;
}
