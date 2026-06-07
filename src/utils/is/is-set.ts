/**
 * Checks whether a value is a `Set`.
 *
 * @example
 * ```ts
 * isSet(new Set()) // -> true
 * isSet(new Map()) // -> false
 * isSet([])        // -> false
 * ```
 */
export function isSet<T extends Set<unknown> = Set<unknown>>(value: unknown): value is T {
  return value instanceof Set;
}
