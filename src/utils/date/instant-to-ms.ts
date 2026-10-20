import { coerceToDate } from '../coerce/coerce-to-date.ts';
import { isDate } from '../is/is-date.ts';

/**
 * An instant as epoch milliseconds, read from epoch milliseconds or an ISO 8601 string.
 * Anything that reads as neither gives `undefined`, a loose date like `'March 7, 2024'` included.
 *
 * @example
 * ```ts
 * instantToMs(1000)                   // -> 1000
 * instantToMs('1970-01-01T00:00:01Z') // -> 1000
 * instantToMs('March 7, 2024')        // -> undefined
 * ```
 */
export function instantToMs(value: unknown): number | undefined {
  const date = coerceToDate(value);
  return isDate(date) && !Number.isNaN(date.getTime()) ? date.getTime() : undefined;
}
