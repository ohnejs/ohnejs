import { isString } from '../is/is-string.ts';

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Checks whether a value is an env var name a `.env` file can set.
 * It starts with a letter or `_`, and letters, digits and `_` follow.
 *
 * @example
 * ```ts
 * isEnvName('ANTHROPIC_API_KEY') // -> true
 * isEnvName('_PRIVATE')          // -> true
 * isEnvName('2FA_SECRET')        // -> false
 * isEnvName('api-key')           // -> false
 * ```
 */
export function isEnvName(value: unknown): value is string {
  return isString(value) && ENV_NAME.test(value);
}
