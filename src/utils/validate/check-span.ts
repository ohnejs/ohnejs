import type { ValidationBounds, ValidationFailure } from './validation-failure.ts';

import { parseWholeDuration } from '../duration/parse-whole-duration.ts';
import { stringifyDuration } from '../duration/stringify-duration.ts';
import { isUndefined } from '../is/is-undefined.ts';

/**
 * Fails a span from `start` to `end`, both in milliseconds, that runs backwards or falls outside `bounds`.
 * A backward span is `validation.invalidRange`; a short or long one names its bound in canonical text.
 * Each bound is milliseconds or duration text like `'1 day'`; a bound that does not parse never fails.
 *
 * @example
 * ```ts
 * checkSpan(5, 1, {})
 * // -> 'validation.invalidRange'
 *
 * checkSpan(0, 3_600_000, { min: '1d' })
 * // -> { key: 'validation.minSpan', params: { min: '1d' } }
 *
 * checkSpan(0, 3_600_000, { max: '2h' })
 * // -> undefined
 * ```
 */
export function checkSpan(
  start: number,
  end: number,
  bounds: ValidationBounds<number | string>,
): ValidationFailure | undefined {
  if (start > end) return 'validation.invalidRange';
  const span = end - start;
  const min = parseWholeDuration(bounds.min);
  const max = parseWholeDuration(bounds.max);
  if (!isUndefined(min) && span < min) {
    return { key: 'validation.minSpan', params: { min: stringifyDuration(min) } };
  }
  if (!isUndefined(max) && span > max) {
    return { key: 'validation.maxSpan', params: { max: stringifyDuration(max) } };
  }
  return undefined;
}
