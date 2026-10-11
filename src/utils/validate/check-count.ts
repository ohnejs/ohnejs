import type { ValidationBounds, ValidationFailure } from './validation-failure.ts';

import { isUndefined } from '../is/is-undefined.ts';

/**
 * Fails a list size outside `bounds` with `validation.minItems` or `validation.maxItems`.
 *
 * @example
 * ```ts
 * checkCount(0, { min: 1 }) // -> { key: 'validation.minItems', params: { min: 1 } }
 * checkCount(4, { max: 3 }) // -> { key: 'validation.maxItems', params: { max: 3 } }
 * checkCount(2, { max: 3 }) // -> undefined
 * ```
 */
export function checkCount(count: number, bounds: ValidationBounds): ValidationFailure | undefined {
  const { min, max } = bounds;
  if (!isUndefined(min) && count < min) return { key: 'validation.minItems', params: { min } };
  if (!isUndefined(max) && count > max) return { key: 'validation.maxItems', params: { max } };
  return undefined;
}
