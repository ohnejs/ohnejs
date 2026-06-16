import { coerceToDate } from '../coerce/coerce-to-date.ts';
import { isDate } from '../is/is-date.ts';

/**
 * Parses a value as a `Date`.
 * Accepts valid `Date` instances, finite numbers (unix-ms), and ISO-shaped date strings.
 * Throws on Invalid Date, non-ISO strings, impossible calendar dates, and every other input.
 *
 * @example
 * ```ts
 * parseDate(new Date())    // -> Date
 * parseDate(1718000000000) // -> Date(2024-06-10T...)
 * parseDate('2024-06-10')  // -> Date(2024-06-10T...)
 * parseDate('2024-02-30')  // throws (impossible calendar date)
 * parseDate('not-a-date')  // throws
 * parseDate(true)          // throws
 * ```
 */
export function parseDate(raw: unknown): Date {
  const d = coerceToDate(raw);
  if (isDate(d)) return d;
  throw new Error(`Expected date, got: ${String(raw)}`);
}
