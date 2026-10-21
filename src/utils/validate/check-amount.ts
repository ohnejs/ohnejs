import type { CurrencyCode } from '../i18n/currency-digits.ts';
import type { StepGrid } from '../number/step-value.ts';
import type { ValidationFailure } from './validation-failure.ts';

import { isString } from '../is/is-string.ts';
import { isUndefined } from '../is/is-undefined.ts';
import { mapValues } from '../object/map-values.ts';
import { checkRange } from './check-range.ts';
import { checkStep } from './check-step.ts';

/**
 * Fails an amount as `checkRange` and then `checkStep` do, naming every value as an `Amount` in `currency`.
 * The grid and the value are minor units, so a message writes each named value as money.
 *
 * @example
 * ```ts
 * checkAmount(50, { min: 100 }, 'EUR')
 * // -> { key: 'validation.minValue', params: { min: { minor: 100, currency: 'EUR' } } }
 *
 * checkAmount(150, { step: 100 }, 'EUR')
 * // -> { key: 'validation.invalidStep', params: { step: { minor: 100, currency: 'EUR' } } }
 * ```
 */
export function checkAmount(
  value: number,
  grid: StepGrid,
  currency: CurrencyCode,
): ValidationFailure | undefined {
  const failure = checkRange(value, grid) ?? checkStep(value, grid);
  if (isUndefined(failure) || isString(failure)) return failure;
  return {
    key: failure.key,
    params: mapValues(failure.params, (_, minor) => ({ minor: minor as number, currency })),
  };
}
