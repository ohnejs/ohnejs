import { currencyCodes, isCurrencyCode } from 'ohnejs/utils';

import { isoCodeField } from './_iso-code.ts';

/**
 * The `currency` field type: an ISO 4217 code of a circulating currency, like `EUR`, stored in upper case.
 *
 * Any other value rejects with `validation.invalidCurrency`, fund and metal codes included.
 * `only` narrows the currencies a field admits.
 * The dashboard shows the currency's name in the viewer's language.
 * Search is off until a field sets `search: true`; then the code or a word start of the name matches.
 */
export default isoCodeField({
  codes: currencyCodes,
  isCode: isCurrencyCode,
  kind: 'currency',
  typeName: 'CurrencyCode',
  invalid: 'validation.invalidCurrency',
  name: 'ISO 4217 currency code',
  example: 'EUR',
});
