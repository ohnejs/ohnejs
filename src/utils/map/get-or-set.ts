import { isUndefined } from '../is/is-undefined.ts';

/**
 * Reads `key` from `map`, creating and storing its value on the first read.
 * `create` runs once per key, so the map memoizes whatever it builds.
 *
 * @example
 * ```ts
 * const formats = new Map<string, Intl.NumberFormat>()
 *
 * getOrSet(formats, 'de', () => new Intl.NumberFormat('de')) // -> the new formatter
 * getOrSet(formats, 'de', () => new Intl.NumberFormat('de')) // -> the same formatter
 * ```
 */
export function getOrSet<K, V>(
  map: { get(key: K): V | undefined; set(key: K, value: V): unknown },
  key: K,
  create: () => V,
): V {
  const existing = map.get(key);
  if (!isUndefined(existing)) return existing;
  const value = create();
  map.set(key, value);
  return value;
}
