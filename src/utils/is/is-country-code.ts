import type { CountryCode } from '../i18n/country-codes.ts';

import { countryCodes } from '../i18n/country-codes.ts';

const codes: ReadonlySet<string> = new Set(countryCodes);

/**
 * Checks whether a value is an ISO 3166-1 alpha-2 country code, in upper case.
 * Aliases like `UK` and groupings like `EU` fail, though `Intl` names them.
 *
 * @example
 * ```ts
 * isCountryCode('DE') // -> true
 * isCountryCode('de') // -> false
 * isCountryCode('UK') // -> false
 * ```
 */
export function isCountryCode(value: unknown): value is CountryCode {
  return codes.has(value as string);
}
