import { isString } from './is-string.ts';

/**
 * Checks whether a value is a time zone name `Intl.DateTimeFormat` accepts.
 * IANA names and their aliases pass in any letter case, `UTC` included.
 * The empty string, `local`, and anything but a string do not.
 *
 * @example
 * ```ts
 * isTimezone('Europe/Berlin') // -> true
 * isTimezone('US/Pacific')    // -> true
 * isTimezone('UTC')           // -> true
 * isTimezone('local')         // -> false
 * isTimezone('')              // -> false
 * ```
 */
export function isTimezone(value: unknown): value is string {
  if (!isString(value)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
