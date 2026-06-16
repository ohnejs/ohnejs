import { coerceToBoolean } from '../coerce/coerce-to-boolean.ts';
import { isBoolean } from '../is/is-boolean.ts';

/**
 * Parses a value as a boolean.
 * Accepts `true` / `false`, numeric `1` / `0`, and case-insensitive `'true'` / `'false'` / `'1'` / `'0'`.
 * Throws on every other input.
 *
 * @example
 * ```ts
 * parseBoolean(true)   // -> true
 * parseBoolean(0)      // -> false
 * parseBoolean('TRUE') // -> true
 * parseBoolean('0')    // -> false
 * parseBoolean('yes')  // throws
 * parseBoolean(2)      // throws
 * parseBoolean(null)   // throws
 * ```
 */
export function parseBoolean(raw: unknown): boolean {
  const b = coerceToBoolean(raw);
  if (isBoolean(b)) return b;
  throw new Error(`Expected boolean, got: ${String(raw)}`);
}
