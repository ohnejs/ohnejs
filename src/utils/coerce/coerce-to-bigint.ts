import { isBigInt } from '../is/is-bigint.ts';
import { isBoolean } from '../is/is-boolean.ts';
import { isInteger } from '../is/is-integer.ts';
import { isString } from '../is/is-string.ts';

const BIGINT_SHAPE = /^[+-]?(?:0|[1-9]\d*)$/;
const BIGINT_MAX_LEN = 1024;

/**
 * Coerces safe-integer numbers, integer-shaped strings, and booleans to `bigint`.
 * Decimals, unsafe ints, leading-zero strings, and strings over 1024 chars pass through.
 *
 * @example
 * ```ts
 * coerceToBigInt(42)    // -> 42n
 * coerceToBigInt('123') // -> 123n
 * coerceToBigInt('+5')  // -> 5n
 * coerceToBigInt(true)  // -> 1n
 * coerceToBigInt('007') // -> '007'
 * coerceToBigInt('1.5') // -> '1.5'
 * coerceToBigInt(null)  // -> null
 * ```
 */
export function coerceToBigInt<T>(value: T): T | bigint {
  if (isBigInt(value)) return value;
  if (isInteger(value)) return BigInt(value);
  if (isString(value) && value.length <= BIGINT_MAX_LEN && BIGINT_SHAPE.test(value)) {
    return BigInt(value);
  }
  if (isBoolean(value)) return value ? 1n : 0n;
  return value;
}
