import { isISOTime } from '../is/is-iso-time.ts';

/**
 * The milliseconds into the day of an ISO time like `09:30` or `09:30:15`, or `undefined` when it is none.
 * `24:00` is no time of day.
 *
 * @example
 * ```ts
 * isoTimeToMs('09:30')    // -> 34200000
 * isoTimeToMs('00:00:01') // -> 1000
 * isoTimeToMs('24:00')    // -> undefined
 * ```
 */
export function isoTimeToMs(value: string): number | undefined {
  if (!isISOTime(value)) return undefined;
  const [hours = 0, minutes = 0, seconds = 0] = value.split(':').map(Number);
  return ((hours * 60 + minutes) * 60 + seconds) * 1000;
}
