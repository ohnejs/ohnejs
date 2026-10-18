import type { ValidationBounds, ValidationFailure } from './validation-failure.ts';

import { parseWholeDuration } from '../duration/parse-whole-duration.ts';
import { stringifyDuration } from '../duration/stringify-duration.ts';
import { isUndefined } from '../is/is-undefined.ts';

/**
 * Fails a duration in milliseconds outside `bounds`, each given as ms or as duration text like `'15m'`.
 * The failing bound is named in canonical text, like `{ max: '2h' }`.
 * A bound that does not parse never fails.
 *
 * @example
 * ```ts
 * checkDuration(60_000, { min: '5m' })   // -> { key: 'validation.minValue', params: { min: '5m' } }
 * checkDuration(7_200_001, { max: '2h' }) // -> { key: 'validation.maxValue', params: { max: '2h' } }
 * checkDuration(600_000, { min: 0 })     // -> undefined
 * ```
 */
export function checkDuration(
  value: number,
  bounds: ValidationBounds<number | string>,
): ValidationFailure | undefined {
  const min = parseWholeDuration(bounds.min);
  const max = parseWholeDuration(bounds.max);
  if (!isUndefined(min) && value < min) {
    return { key: 'validation.minValue', params: { min: stringifyDuration(min) } };
  }
  if (!isUndefined(max) && value > max) {
    return { key: 'validation.maxValue', params: { max: stringifyDuration(max) } };
  }
  return undefined;
}
