import { isISODate } from '../is/is-iso-date.ts';

/**
 * The UTC-midnight timestamp of an ISO day like `2024-02-29`, or `undefined` when it is no real day.
 * Years 00-99 stay literal, where `Date.UTC` would move them to the 1900s.
 *
 * @example
 * ```ts
 * isoDayToMs('1970-01-02') // -> 86400000
 * isoDayToMs('0050-01-01') // -> -60589296000000
 * isoDayToMs('2023-02-29') // -> undefined
 * ```
 */
export function isoDayToMs(value: string): number | undefined {
  if (!isISODate(value)) return undefined;
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getTime();
}
