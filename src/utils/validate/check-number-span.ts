import type { CurrencyCode } from '../i18n/currency-digits.ts';
import type { ValidationBounds, ValidationFailure } from './validation-failure.ts';

import { isUndefined } from '../is/is-undefined.ts';
import { alignDecimals } from '../number/align-decimals.ts';

/**
 * Fails a span from `start` to `end` that runs backwards or falls outside `bounds`, exactly in decimal.
 * A backward span is `validation.invalidRange`; a short or long one names its bound.
 * With a `currency` the bounds are minor units, and the named bound is an `Amount`.
 *
 * @example
 * ```ts
 * checkNumberSpan(0.1, 0.3, { max: 0.2 })
 * // -> undefined
 *
 * checkNumberSpan(10, 12, { min: 5 })
 * // -> { key: 'validation.minSpan', params: { min: 5 } }
 *
 * checkNumberSpan(0, 900, { max: 500 }, 'EUR')
 * // -> { key: 'validation.maxSpan', params: { max: { minor: 500, currency: 'EUR' } } }
 * ```
 */
export function checkNumberSpan(
  start: number,
  end: number,
  bounds: ValidationBounds,
  currency?: CurrencyCode,
): ValidationFailure | undefined {
  const named = (bound: number) => (isUndefined(currency) ? bound : { minor: bound, currency });
  if (start > end) return 'validation.invalidRange';
  const { min, max } = bounds;
  const {
    coefficients: [from = 0n, to = 0n, low = 0n, high = 0n],
  } = alignDecimals([start, end, min ?? 0, max ?? 0]);
  if (!isUndefined(min) && to - from < low) {
    return { key: 'validation.minSpan', params: { min: named(min) } };
  }
  if (!isUndefined(max) && to - from > high) {
    return { key: 'validation.maxSpan', params: { max: named(max) } };
  }
  return undefined;
}
