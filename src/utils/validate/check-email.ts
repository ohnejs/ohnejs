import type { ValidationFailure } from './validation-failure.ts';

import { isEmail } from '../is/is-email.ts';

/**
 * Fails a value that is no email address, as `validation.invalidEmail`.
 *
 * @example
 * ```ts
 * checkEmail('thrall@orgrimmar.example') // -> undefined
 * checkEmail('thrall')                   // -> 'validation.invalidEmail'
 * ```
 */
export function checkEmail(value: string): ValidationFailure | undefined {
  return isEmail(value) ? undefined : 'validation.invalidEmail';
}
