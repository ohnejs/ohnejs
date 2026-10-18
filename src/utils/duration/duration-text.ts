import { isUndefined } from '../is/is-undefined.ts';
import { parseWholeDuration } from './parse-whole-duration.ts';
import { stringifyDuration } from './stringify-duration.ts';

/**
 * The text an input shows for a duration: its canonical form, or the value as given when it is none.
 * It never throws, so a stored negative or a raw string from a URL still renders.
 *
 * @example
 * ```ts
 * durationText(5_400_000) // -> '1h 30m'
 * durationText('90m')     // -> '1h 30m'
 * durationText(-1)        // -> '-1'
 * ```
 */
export function durationText(value: unknown): string {
  const ms = parseWholeDuration(value);
  return isUndefined(ms) ? String(value) : stringifyDuration(ms);
}
