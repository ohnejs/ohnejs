import type { ValidationBounds, ValidationFailure } from './validation-failure.ts';

import { isString } from '../is/is-string.ts';
import { isUndefined } from '../is/is-undefined.ts';
import { checkRange } from './check-range.ts';

/**
 * Fails an amount outside `bounds` as `checkRange` does, with the failing bound written by `show`.
 * The bounds and the value are minor units; `show` turns a bound into the amount a reader recognizes.
 *
 * @example
 * ```ts
 * checkAmount(50, { min: 100 }, (minor) => `${minor / 100} EUR`)
 * // -> { key: 'validation.minValue', params: { min: '1 EUR' } }
 * ```
 */
export function checkAmount(
  value: number,
  bounds: ValidationBounds,
  show: (minor: number) => string,
): ValidationFailure | undefined {
  const failure = checkRange(value, bounds);
  if (isUndefined(failure) || isString(failure)) return failure;
  const name = failure.key === 'validation.minValue' ? 'min' : 'max';
  return { key: failure.key, params: { [name]: show(failure.params[name] as number) } };
}
