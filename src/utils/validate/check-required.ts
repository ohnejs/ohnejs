import type { ValidationFailure } from './validation-failure.ts';

import { isUndefined } from '../is/is-undefined.ts';

/**
 * Fails an absent value with `validation.required`.
 * Only `undefined` is absent: a `null` or an empty value is an answer, judged by other checks.
 *
 * @example
 * ```ts
 * checkRequired(undefined) // -> 'validation.required'
 * checkRequired(null)      // -> undefined
 * checkRequired('')        // -> undefined
 * ```
 */
export function checkRequired(value: unknown): ValidationFailure | undefined {
  return isUndefined(value) ? 'validation.required' : undefined;
}
