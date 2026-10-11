import type { Registry } from './create-registry.ts';

/**
 * Replaces every entry of `registry` with `entries`, registered in order.
 * Returns a function that puts the previous entries back, in their original order.
 *
 * @example
 * ```ts
 * const r = createRegistry<number>()
 * r.register('a', 1)
 * const restore = swapRegistry(r, [['b', 2]])
 * r.keys() // -> ['b']
 * restore()
 * r.keys() // -> ['a']
 * ```
 */
export function swapRegistry<V>(
  registry: Registry<V>,
  entries: Iterable<readonly [string, V]>,
): () => void {
  const previous = Object.entries(registry.all());
  fill(registry, entries);
  return () => fill(registry, previous);
}

/**
 * Clears `registry`, then registers each of `entries`.
 */
function fill<V>(registry: Registry<V>, entries: Iterable<readonly [string, V]>): void {
  registry.clear();
  for (const [key, value] of entries) registry.register(key, value);
}
