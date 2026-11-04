import { roundTo } from '../number/round-to.ts';

const LARGEST = 5;

/**
 * The power of 1024 a byte count reads best in, from `0` for bytes up to `5` for petabytes.
 * It is the largest unit that keeps the count at `1` or more once rounded to `decimals` in that unit.
 * Bytes round to whole numbers.
 *
 * @example
 * ```ts
 * byteExponent(512)        // -> 0
 * byteExponent(1536)       // -> 1
 * byteExponent(1048575)    // -> 2
 * byteExponent(1048575, 3) // -> 1
 * ```
 */
export function byteExponent(bytes: number, decimals: number = 2): number {
  const shown = (exponent: number): number =>
    roundTo(bytes / 1024 ** exponent, exponent === 0 ? 0 : decimals);
  let exponent = 0;
  while (exponent < LARGEST && shown(exponent) >= 1024) exponent++;
  return exponent;
}
