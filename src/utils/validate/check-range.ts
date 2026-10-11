import type { ValidationBounds, ValidationFailure } from './validation-failure.ts';

import { isUndefined } from '../is/is-undefined.ts';

/**
 * Fails a value outside `bounds` with `validation.minValue` or `validation.maxValue`.
 * Numbers compare numerically; strings compare by code unit, which orders ISO dates and times.
 *
 * @example
 * ```ts
 * checkRange(0, { min: 1 })                       // -> { key: 'validation.minValue', params: { min: 1 } }
 * checkRange(11, { max: 10 })                     // -> { key: 'validation.maxValue', params: { max: 10 } }
 * checkRange('2026-01-02', { min: '2026-01-01' }) // -> undefined
 * ```
 */
export function checkRange<T extends number | string>(
  value: T,
  bounds: ValidationBounds<T>,
): ValidationFailure | undefined {
  const { min, max } = bounds;
  if (!isUndefined(min) && value < min) return { key: 'validation.minValue', params: { min } };
  if (!isUndefined(max) && value > max) return { key: 'validation.maxValue', params: { max } };
  return undefined;
}
