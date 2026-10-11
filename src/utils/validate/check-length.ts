import type { ValidationBounds, ValidationFailure } from './validation-failure.ts';

import { isUndefined } from '../is/is-undefined.ts';

/**
 * Fails a character count outside `bounds` with `validation.minLength` or `validation.maxLength`.
 *
 * @example
 * ```ts
 * checkLength(2, { min: 3 }) // -> { key: 'validation.minLength', params: { min: 3 } }
 * checkLength(9, { max: 8 }) // -> { key: 'validation.maxLength', params: { max: 8 } }
 * checkLength(5, { min: 3 }) // -> undefined
 * ```
 */
export function checkLength(
  length: number,
  bounds: ValidationBounds,
): ValidationFailure | undefined {
  const { min, max } = bounds;
  if (!isUndefined(min) && length < min) return { key: 'validation.minLength', params: { min } };
  if (!isUndefined(max) && length > max) return { key: 'validation.maxLength', params: { max } };
  return undefined;
}
