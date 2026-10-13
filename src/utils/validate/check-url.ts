import type { ValidationFailure } from './validation-failure.ts';

import { isHTTPURL } from '../is/is-http-url.ts';

/**
 * Fails a value that is no absolute `http:` or `https:` address, as `validation.invalidURL`.
 *
 * @example
 * ```ts
 * checkURL('https://dalaran.example') // -> undefined
 * checkURL('dalaran.example')         // -> 'validation.invalidURL'
 * ```
 */
export function checkURL(value: string): ValidationFailure | undefined {
  return isHTTPURL(value) ? undefined : 'validation.invalidURL';
}
