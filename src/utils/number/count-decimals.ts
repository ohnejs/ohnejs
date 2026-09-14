/**
 * Counts the decimal places of the shortest decimal a number prints as.
 * Exponent notation counts too, so `1e-7` has 7.
 *
 * A whole number, `NaN`, and an infinity have none.
 *
 * @example
 * ```ts
 * countDecimals(42)        // -> 0
 * countDecimals(1.5)       // -> 1
 * countDecimals(0.1 + 0.2) // -> 17
 * countDecimals(1e-7)      // -> 7
 * countDecimals(Infinity)  // -> 0
 * ```
 */
export function countDecimals(value: number): number {
  const [coefficient = '', exponent = '0'] = String(value).split('e');
  return Math.max(0, (coefficient.split('.')[1]?.length ?? 0) - Number(exponent));
}
