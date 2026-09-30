/**
 * Returns `items` with a separator between each neighbouring pair.
 * `separator` is called once per gap, so every separator can be a fresh value, such as a DOM node.
 *
 * @example
 * ```ts
 * intersperse([1, 2, 3], () => 0) // -> [1, 0, 2, 0, 3]
 * intersperse([], () => 0)        // -> []
 * ```
 */
export function intersperse<T, S>(items: readonly T[], separator: () => S): (T | S)[] {
  return items.flatMap((item, index) => (index === 0 ? [item] : [separator(), item]));
}
