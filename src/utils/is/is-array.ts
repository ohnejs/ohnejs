/**
 * Checks whether a value is an array.
 * Pass an array type parameter to narrow the element type.
 *
 * @example
 * ```ts
 * isArray([1, 2])             // -> true
 * isArray('a,b')              // -> false
 * if (isArray<string[]>(v)) v // typed as string[]
 * ```
 */
export function isArray<T extends unknown[] = unknown[]>(value: unknown): value is T {
  return Array.isArray(value);
}
