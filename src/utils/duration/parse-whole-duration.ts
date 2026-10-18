import { isInteger } from '../is/is-integer.ts';
import { isNumber } from '../is/is-number.ts';
import { isString } from '../is/is-string.ts';
import { parseDuration } from './parse-duration.ts';

/**
 * Reads a duration as whole, non-negative milliseconds, or `undefined` when it is none; it never throws.
 * A string takes `parseDuration`'s units, commas count as spaces, and the total rounds to the nearest ms.
 * A bare number string other than `'0'` names no unit, so it gives `undefined`.
 *
 * @example
 * ```ts
 * parseWholeDuration('1h 30m')             // -> 5400000
 * parseWholeDuration('1 hour, 30 minutes') // -> 5400000
 * parseWholeDuration('0')                  // -> 0
 * parseWholeDuration('0.5ms')              // -> 1
 * parseWholeDuration('90')                 // -> undefined
 * parseWholeDuration(-1)                   // -> undefined
 * ```
 */
export function parseWholeDuration(input: unknown): number | undefined {
  if (isNumber(input)) return isInteger(input) && input >= 0 ? input : undefined;
  if (!isString(input)) return undefined;
  const text = input.replaceAll(',', ' ').trim();
  if (text === '0') return 0;
  if (/^[+-]?[\d.]+$/.test(text)) return undefined;
  try {
    const ms = Math.round(parseDuration(text));
    return isInteger(ms) && ms >= 0 ? ms : undefined;
  } catch {
    return undefined;
  }
}
