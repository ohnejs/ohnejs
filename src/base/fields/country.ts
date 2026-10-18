import { countryCodes, isCountryCode } from 'ohnejs/utils';

import { isoCodeField } from './_iso-code.ts';

/**
 * The `country` field type: an ISO 3166-1 alpha-2 country code, like `DE`, stored in upper case.
 *
 * Any other value rejects with `validation.invalidCountry`; aliases like `UK` are not codes.
 * `only` narrows the countries a field admits.
 * The dashboard shows the country's name in the viewer's language.
 * Search is off until a field sets `search: true`; then the code or a word start of the name matches.
 */
export default isoCodeField({
  codes: countryCodes,
  isCode: isCountryCode,
  kind: 'region',
  typeName: 'CountryCode',
  invalid: 'validation.invalidCountry',
  name: 'ISO 3166-1 country code',
  example: 'DE',
});
