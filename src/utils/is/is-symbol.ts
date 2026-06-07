/**
 * Checks whether a value is a symbol.
 *
 * @example
 * ```ts
 * isSymbol(Symbol('x')) // -> true
 * isSymbol('x')         // -> false
 * ```
 */
export function isSymbol(value: unknown): value is symbol {
  return typeof value === 'symbol';
}
