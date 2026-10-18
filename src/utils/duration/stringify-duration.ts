import { isInteger } from '../is/is-integer.ts';

const UNITS: readonly [suffix: string, ms: number][] = [
  ['d', 86_400_000],
  ['h', 3_600_000],
  ['m', 60_000],
  ['s', 1_000],
  ['ms', 1],
];

/**
 * Writes whole milliseconds as the canonical duration text `parseDuration` reads back exactly.
 * Units run greedily from days to milliseconds and zero units are left out, so `0` is `'0ms'`.
 * Anything but a non-negative safe integer throws.
 *
 * @example
 * ```ts
 * stringifyDuration(5_400_000)  // -> '1h 30m'
 * stringifyDuration(0)          // -> '0ms'
 * stringifyDuration(90_061_001) // -> '1d 1h 1m 1s 1ms'
 * ```
 */
export function stringifyDuration(ms: number): string {
  if (!isInteger(ms) || ms < 0) throw new Error(`Invalid duration: ${ms}`);
  if (ms === 0) return '0ms';
  const parts: string[] = [];
  let rest = ms;
  for (const [suffix, size] of UNITS) {
    const count = Math.floor(rest / size);
    if (count === 0) continue;
    parts.push(`${count}${suffix}`);
    rest -= count * size;
  }
  return parts.join(' ');
}
