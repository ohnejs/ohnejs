/**
 * Stores `value` under `key` as the map's newest entry, then drops the oldest entries past `limit`.
 * A key set again moves to the newest end, so setting a read value back keeps it as recently used.
 *
 * @example
 * ```ts
 * const recent = new Map([['a', 1], ['b', 2]])
 *
 * setCapped(recent, 'a', 1, 2) // -> Map { 'b' => 2, 'a' => 1 }
 * setCapped(recent, 'c', 3, 2) // -> Map { 'a' => 1, 'c' => 3 }
 * ```
 */
export function setCapped<K, V>(map: Map<K, V>, key: K, value: V, limit: number): Map<K, V> {
  map.delete(key);
  map.set(key, value);
  for (const oldest of map.keys()) {
    if (map.size <= limit) break;
    map.delete(oldest);
  }
  return map;
}
