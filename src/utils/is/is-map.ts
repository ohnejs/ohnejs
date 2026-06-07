/**
 * Checks whether a value is a `Map`.
 *
 * @example
 * ```ts
 * isMap(new Map()) // -> true
 * isMap(new Set()) // -> false
 * isMap({})        // -> false
 * ```
 */
export function isMap<T extends Map<unknown, unknown> = Map<unknown, unknown>>(
  value: unknown,
): value is T {
  return value instanceof Map;
}
