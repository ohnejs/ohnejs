/**
 * Numbers rewritten as whole coefficients over one shared power of ten.
 */
export interface AlignedDecimals {
  /**
   * Each value times `10 ** scale`, exactly, in the order given.
   */
  coefficients: bigint[];

  /**
   * The decimal places every coefficient shares: the most any value prints with.
   */
  scale: number;
}

/**
 * Rewrites numbers as whole coefficients over one shared power of ten, so decimal arithmetic stays exact.
 * Each value equals its coefficient times `10 ** -scale`, from the shortest decimal it prints as.
 * A non-finite value throws, as `BigInt` does.
 *
 * @example
 * ```ts
 * alignDecimals([0.25, 3])  // -> { coefficients: [25n, 300n], scale: 2 }
 * alignDecimals([0.1, 0.2]) // -> { coefficients: [1n, 2n], scale: 1 }
 * alignDecimals([1e21])     // -> { coefficients: [1000000000000000000000n], scale: 0 }
 * ```
 */
export function alignDecimals(values: readonly number[]): AlignedDecimals {
  const parts = values.map((value): [bigint, number] => {
    const [coefficient = '', exponent = '0'] = String(value).split('e');
    const [integer = '', fraction = ''] = coefficient.split('.');
    return [BigInt(integer + fraction), fraction.length - Number(exponent)];
  });
  const scale = Math.max(0, ...parts.map(([, places]) => places));
  return {
    coefficients: parts.map(([digits, places]) => digits * 10n ** BigInt(scale - places)),
    scale,
  };
}
