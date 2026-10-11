import type { ValidationBounds, ValidationFailure } from './validation-failure.ts';

import { checkLength } from './check-length.ts';

/**
 * Options for `checkText`.
 */
export interface CheckTextOptions extends ValidationBounds {
  /**
   * Whether `''` is a legal value.
   *
   * @default
   * false
   */
  readonly allowEmpty?: boolean | undefined;
}

/**
 * Fails a text value the `text` field type rejects.
 * An empty string fails with `validation.emptyValue` unless `allowEmpty` is set.
 * A length outside `min` and `max`, counted in UTF-16 units like `String#length`, fails as `checkLength`.
 *
 * @example
 * ```ts
 * checkText('', {})                   // -> 'validation.emptyValue'
 * checkText('', { allowEmpty: true }) // -> undefined
 * checkText('ab', { min: 3 })         // -> { key: 'validation.minLength', params: { min: 3 } }
 * checkText('Thrall', { max: 10 })    // -> undefined
 * ```
 */
export function checkText(
  value: string,
  options: CheckTextOptions = {},
): ValidationFailure | undefined {
  if (value === '' && !options.allowEmpty) return 'validation.emptyValue';
  return checkLength(value.length, options);
}
