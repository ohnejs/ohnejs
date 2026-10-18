/**
 * Parses an amount typed in major units into whole minor units, scaled exactly in decimal.
 * It takes an optional sign, digits, and one `.` or `,` before at most `digits` fraction digits.
 * Group separators, exponents, and a result past the safe integer range give `undefined`.
 *
 * @example
 * ```ts
 * parseMinorUnits('12.34', 2)  // -> 1234
 * parseMinorUnits('12,3', 2)   // -> 1230
 * parseMinorUnits('-0.05', 2)  // -> -5
 * parseMinorUnits('12.345', 2) // -> undefined
 * parseMinorUnits('1.5', 0)    // -> undefined
 * ```
 */
export function parseMinorUnits(text: string, digits: number): number | undefined {
  const match = /^([+-]?)(\d*)(?:[.,](\d*))?$/.exec(text.trim());
  if (match === null) return undefined;
  const [, sign = '', whole = '', fraction = ''] = match;
  if (whole === '' && fraction === '') return undefined;
  if (fraction.length > digits) return undefined;
  const minor = BigInt(`${whole || '0'}${fraction.padEnd(digits, '0')}`);
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
  return sign === '-' && minor !== 0n ? -Number(minor) : Number(minor);
}
