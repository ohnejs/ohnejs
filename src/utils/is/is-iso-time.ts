import { isString } from './is-string.ts';

const ISO_TIME = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

/**
 * Checks whether a value is an ISO time of day: `HH:MM` or `HH:MM:SS` on the 24-hour clock.
 *
 * @example
 * ```ts
 * isISOTime('09:30')    // -> true
 * isISOTime('23:59:59') // -> true
 * isISOTime('24:00')    // -> false
 * isISOTime('9:30')     // -> false
 * ```
 */
export function isISOTime(value: unknown): value is string {
  return isString(value) && ISO_TIME.test(value);
}
