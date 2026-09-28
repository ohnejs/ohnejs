import { isRealNumber } from '../is/is-real-number.ts';
import { roundTo } from '../number/round-to.ts';

const UNITS = ['b', 'kb', 'mb', 'gb', 'tb', 'pb'];

/**
 * Formats a byte count into a compact, human-readable string.
 *
 * Picks the largest unit that keeps the value at or above 1, so `1536` reads as `'1.5kb'`.
 * Units are binary and match `parseBytes`: `kb` is 1024 bytes, `mb` is 1024 kb, and so on.
 *
 * The byte unit is always a whole number; larger units keep up to `decimals` places, trailing zeros trimmed.
 *
 * @example
 * ```ts
 * formatBytes(0)          // -> '0b'
 * formatBytes(512)        // -> '512b'
 * formatBytes(1024)       // -> '1kb'
 * formatBytes(1536)       // -> '1.5kb'
 * formatBytes(1610612736) // -> '1.5gb'
 * formatBytes(1234567, 1) // -> '1.2mb'
 * ```
 */
export function formatBytes(bytes: number, decimals: number = 2): string {
  if (!isRealNumber(bytes) || bytes < 0) {
    throw new Error(`Invalid byte size: ${bytes}`);
  }

  const shown = (unit: number) => roundTo(bytes / 1024 ** unit, unit === 0 ? 0 : decimals);
  let exp = 0;
  while (exp < UNITS.length - 1 && shown(exp) >= 1024) exp++;
  return `${shown(exp)}${UNITS[exp]}`;
}
