import { isNull } from './is-null.ts';
import { isString } from './is-string.ts';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Checks whether a value is an ISO calendar date: a real day in `YYYY-MM-DD` form.
 * The shape alone is not enough - the day must exist in its month.
 *
 * @example
 * ```ts
 * isISODate('2024-02-29') // -> true
 * isISODate('2023-02-29') // -> false
 * isISODate('2024-13-01') // -> false
 * isISODate('2024-1-1')   // -> false
 * ```
 */
export function isISODate(value: unknown): value is string {
  if (!isString(value)) return false;
  const match = ISO_DATE.exec(value);
  if (isNull(match)) return false;
  const month = Number(match[2]);
  const day = Number(match[3]);
  // `setUTCFullYear` keeps years 00-99 literal, where `Date.UTC` would remap them to 19xx.
  const date = new Date(0);
  date.setUTCFullYear(Number(match[1]), month - 1, day);
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
