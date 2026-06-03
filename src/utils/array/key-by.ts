/**
 * Indexes items by the key returned from `keyFn`.
 * If two items produce the same key, the later item wins.
 *
 * @example
 * ```ts
 * keyBy([{ id: 'a' }, { id: 'b' }], (x) => x.id)
 * // -> { a: { id: 'a' }, b: { id: 'b' } }
 *
 * keyBy(['ab', 'cd', 'ef'], (s) => s[0])
 * // -> { a: 'ab', c: 'cd', e: 'ef' }
 * ```
 */
export function keyBy<T, K extends PropertyKey>(
  array: readonly T[],
  keyFn: (item: T, index: number) => K,
): Partial<Record<K, T>> {
  const result: Partial<Record<K, T>> = {};
  for (let i = 0; i < array.length; i++) {
    const item = array[i] as T;
    result[keyFn(item, i)] = item;
  }
  return result;
}
