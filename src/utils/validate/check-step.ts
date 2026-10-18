import type { StepGrid } from '../number/step-value.ts';
import type { ValidationFailure } from './validation-failure.ts';

import { isUndefined } from '../is/is-undefined.ts';
import { isStepMultiple } from '../number/is-step-multiple.ts';

/**
 * Fails a value off the grid `min + k * step`, or `k * step` without `min`, checked exactly in decimal.
 * A miss is `validation.invalidStep`, or `validation.invalidStepFrom` when `min` shifts the grid off 0.
 * Without `step` nothing fails; the bounds themselves are `checkRange`'s.
 *
 * @example
 * ```ts
 * checkStep(0.3, { step: 0.1 })
 * // -> undefined
 *
 * checkStep(0.35, { step: 0.1 })
 * // -> { key: 'validation.invalidStep', params: { step: 0.1 } }
 *
 * checkStep(1, { step: 0.5, min: 0.25 })
 * // -> { key: 'validation.invalidStepFrom', params: { step: 0.5, min: 0.25 } }
 * ```
 */
export function checkStep(value: number, grid: StepGrid): ValidationFailure | undefined {
  const { step, min } = grid;
  if (isUndefined(step) || isStepMultiple(value, step, min ?? 0)) return undefined;
  return isUndefined(min) || isStepMultiple(min, step)
    ? { key: 'validation.invalidStep', params: { step } }
    : { key: 'validation.invalidStepFrom', params: { step, min } };
}
