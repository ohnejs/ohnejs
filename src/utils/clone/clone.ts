/**
 * Deep clones via `JSON.parse(JSON.stringify(value))`.
 * Cycles, `BigInt`, and top-level non-serializables throw.
 *
 * @example
 * ```ts
 * clone({ x: [1, 2] }) // -> { x: [1, 2] }
 * ```
 */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
