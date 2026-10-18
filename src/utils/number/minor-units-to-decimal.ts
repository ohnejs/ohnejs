/**
 * Writes whole minor units as the exact decimal string of the major amount, never through a float.
 *
 * @example
 * ```ts
 * minorUnitsToDecimal(1234, 2) // -> '12.34'
 * minorUnitsToDecimal(-5, 2)   // -> '-0.05'
 * minorUnitsToDecimal(1234, 0) // -> '1234'
 * ```
 */
export function minorUnitsToDecimal(minor: number, digits: number): `${number}` {
  const text = String(Math.abs(minor)).padStart(digits + 1, '0');
  const whole = text.slice(0, text.length - digits);
  const fraction = text.slice(text.length - digits);
  const sign = minor < 0 ? '-' : '';
  return (digits === 0 ? `${sign}${whole}` : `${sign}${whole}.${fraction}`) as `${number}`;
}
