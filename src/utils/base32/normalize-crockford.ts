import { isASCII } from '../is/is-ascii.ts';
import { CROCKFORD_ALPHABET } from './_alphabet.ts';

const SEPARATORS = /[\s.-]/g;
const LOOKALIKES: Record<string, string> = { O: '0', I: '1', L: '1' };

/**
 * Normalizes typed Crockford base32: uppercased, without whitespace, `-` and `.`.
 * The lookalikes `O`, `I` and `L` read as `0`, `1` and `1`.
 * Returns `undefined` when any other character falls outside the alphabet, `U` included.
 *
 * The length is not checked.
 *
 * @example
 * ```ts
 * normalizeCrockford('k7m4x-q2pzr') // -> 'K7M4XQ2PZR'
 * normalizeCrockford('K7M4X Q2PZR') // -> 'K7M4XQ2PZR'
 * normalizeCrockford('ol1')         // -> '011'
 * normalizeCrockford('olu')         // -> undefined
 * ```
 */
export function normalizeCrockford(text: string): string | undefined {
  const stripped = text.replace(SEPARATORS, '');
  // `toUpperCase` turns non-ASCII letters like `ß`, `ı` and `ſ` into alphabet symbols.
  if (!isASCII(stripped)) return undefined;
  let out = '';
  for (const char of stripped.toUpperCase()) {
    const symbol = LOOKALIKES[char] ?? char;
    if (!CROCKFORD_ALPHABET.includes(symbol)) return undefined;
    out += symbol;
  }
  return out;
}
