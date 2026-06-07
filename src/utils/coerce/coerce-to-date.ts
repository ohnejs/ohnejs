import { isDate } from '../is/is-date.ts';
import { isRealNumber } from '../is/is-real-number.ts';
import { isString } from '../is/is-string.ts';

const ISO_DATE =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * Coerces finite numbers (unix-ms) and ISO-shaped date strings to `Date`.
 * `Date` instances pass through, including Invalid Date.
 * Non-ISO strings and impossible calendar dates pass through.
 *
 * @example
 * ```ts
 * coerceToDate(1718000000000) // -> Date(2024-06-10T...)
 * coerceToDate('2024-06-10')  // -> Date(2024-06-10T...)
 * coerceToDate('2024-02-30')  // -> '2024-02-30'
 * coerceToDate('1')           // -> '1'
 * coerceToDate(null)          // -> null
 * ```
 */
export function coerceToDate<T>(value: T): T | Date {
  if (isDate(value)) return value;
  if (isRealNumber(value)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d;
  }
  if (isString(value) && ISO_DATE.test(value)) {
    try {
      Temporal.PlainDate.from(value.slice(0, 10));
    } catch {
      return value;
    }
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d;
  }
  return value;
}
