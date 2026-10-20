import type { StepGrid } from '../number/step-value.ts';
import type { ValidationFailure } from './validation-failure.ts';

import { isString } from '../is/is-string.ts';
import { isUndefined } from '../is/is-undefined.ts';
import { mapValues } from '../object/map-values.ts';
import { checkRange } from './check-range.ts';
import { checkStep } from './check-step.ts';

/**
 * Fails an amount as `checkRange` and then `checkStep` do, with every value they name written by `show`.
 * The grid and the value are minor units; `show` turns one into the amount a reader recognizes.
 *
 * @example
 * ```ts
 * checkAmount(50, { min: 100 }, (minor) => `${minor / 100} EUR`)
 * // -> { key: 'validation.minValue', params: { min: '1 EUR' } }
 *
 * checkAmount(150, { step: 100 }, (minor) => `${minor / 100} EUR`)
 * // -> { key: 'validation.invalidStep', params: { step: '1 EUR' } }
 * ```
 */
export function checkAmount(
  value: number,
  grid: StepGrid,
  show: (minor: number) => string,
): ValidationFailure | undefined {
  const failure = checkRange(value, grid) ?? checkStep(value, grid);
  if (isUndefined(failure) || isString(failure)) return failure;
  return {
    key: failure.key,
    params: mapValues(failure.params, (_, minor) => show(minor as number)),
  };
}
