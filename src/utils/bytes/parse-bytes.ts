import { isRealNumber } from '../is/is-real-number.ts';
import { isString } from '../is/is-string.ts';
import { isUndefined } from '../is/is-undefined.ts';

const UNITS: Readonly<Record<string, number>> = {
  b: 1,
  byte: 1,
  bytes: 1,

  k: 1024,
  kb: 1024,
  kib: 1024,

  m: 1024 ** 2,
  mb: 1024 ** 2,
  mib: 1024 ** 2,

  g: 1024 ** 3,
  gb: 1024 ** 3,
  gib: 1024 ** 3,

  t: 1024 ** 4,
  tb: 1024 ** 4,
  tib: 1024 ** 4,

  p: 1024 ** 5,
  pb: 1024 ** 5,
  pib: 1024 ** 5,
};

const SIZE = /^\s*(\d+(?:\.\d+)?)\s*([a-z]*)\s*$/i;

/**
 * Parses a human-readable byte size into a whole number of bytes.
 *
 * Accepts a number of bytes or a string of `<value><unit>`.
 * Compact (`'10mb'`), decimal (`'1.5gb'`), and bare-number (`'2048'`) forms all work.
 * Units are case-insensitive and binary: `kb` is 1024 bytes, `mb` is 1024 kb, and so on.
 *
 * Recognized units: `b`/`byte(s)`, `k`/`kb`/`kib`, `m`/`mb`/`mib`, `g`/`gb`/`gib`.
 * Larger units: `t`/`tb`/`tib`, `p`/`pb`/`pib`.
 * A bare number with no unit is bytes.
 *
 * A fractional result is rounded to the nearest whole byte.
 *
 * @example
 * ```ts
 * parseBytes('512')   // -> 512
 * parseBytes('1kb')   // -> 1024
 * parseBytes('10mb')  // -> 10485760
 * parseBytes('1.5gb') // -> 1610612736
 * parseBytes(2048)    // -> 2048
 * parseBytes(2047.6)  // -> 2048
 * ```
 */
export function parseBytes(input: number | string): number {
  if (isString(input)) {
    const match = SIZE.exec(input);
    if (!match) {
      throw new Error(`Invalid byte size: "${input}"`);
    }
    const factor = UNITS[(match[2] || 'b').toLowerCase()];
    if (isUndefined(factor)) {
      throw new Error(`Invalid byte size: "${input}"`);
    }
    return Math.round(Number(match[1]) * factor);
  }

  if (!isRealNumber(input) || input < 0) {
    throw new Error(`Invalid byte size: ${input}`);
  }
  return Math.round(input);
}
