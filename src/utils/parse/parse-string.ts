import { coerceToString } from '../coerce/coerce-to-string.ts';
import { isString } from '../is/is-string.ts';

/**
 * Parses a value as a string.
 * Accepts strings and primitives with a canonical text representation (numbers, booleans, bigints).
 * Throws on arrays, objects, `null`, `undefined`, symbols, and functions.
 *
 * @example
 * ```ts
 * parseString('hi')   // -> 'hi'
 * parseString(42)     // -> '42'
 * parseString(true)   // -> 'true'
 * parseString(42n)    // -> '42'
 * parseString([1, 2]) // throws
 * parseString(null)   // throws
 * parseString({})     // throws
 * ```
 */
export function parseString(raw: unknown): string {
  const s = coerceToString(raw);
  if (isString(s)) return s;
  throw new Error(`Expected string, got: ${String(raw)}`);
}
