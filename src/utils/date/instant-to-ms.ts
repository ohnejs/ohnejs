import { isRealNumber } from '../is/is-real-number.ts';
import { isString } from '../is/is-string.ts';

/**
 * An instant as epoch milliseconds, read from epoch milliseconds or an ISO 8601 string.
 * Anything that reads as neither gives `undefined`.
 *
 * @example
 * ```ts
 * instantToMs(1000)                   // -> 1000
 * instantToMs('1970-01-01T00:00:01Z') // -> 1000
 * instantToMs('soon')                 // -> undefined
 * ```
 */
export function instantToMs(value: unknown): number | undefined {
  const ms = isString(value) ? Date.parse(value) : value;
  return isRealNumber(ms) ? ms : undefined;
}
