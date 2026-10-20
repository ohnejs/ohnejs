import type { DashboardField } from '../../runtime/meta-types.ts';
import type { IntegerFieldOptions } from '../known-field-types.ts';
import type { NumericNotation } from './_numeric.ts';

import { amountEditText } from '../../../utils/i18n/amount-edit-text.ts';
import { currencyAffixIn } from '../../../utils/i18n/currency-affix-in.ts';
import { currencyDigits } from '../../../utils/i18n/currency-digits.ts';
import { formatCurrencyIn } from '../../../utils/i18n/format-currency-in.ts';
import { isCurrencyCode } from '../../../utils/is/is-currency-code.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { clamp } from '../../../utils/number/clamp.ts';
import { stepValue } from '../../../utils/number/step-value.ts';
import { checkAmount } from '../../../utils/validate/check-amount.ts';
import { parseAmountValue } from '../parse.ts';

/**
 * The notation of an `integer` field with a `currency`: minor units read and written as amounts.
 * The text edits in major units with the language's decimal mark, and the input shows the currency symbol.
 * The arrow keys move along the `step` grid in minor units, or by one major unit without it.
 * A failing bound or grid reads as an amount.
 * Without a known `currency` the field keeps the plain notation.
 */
export function amountNotation(
  field: DashboardField<IntegerFieldOptions>,
  language: string,
): NumericNotation | undefined {
  const { currency, min, max, step } = field.options ?? {};
  if (!isCurrencyCode(currency)) return undefined;
  const digits = currencyDigits[currency];
  const show = (minor: number): string => formatCurrencyIn(minor, currency, language);
  return {
    parse: (raw) => parseAmountValue(field, raw, currency, language),
    text: (minor) => amountEditText(minor, digits, language),
    show,
    unit: () => undefined,
    affix: () => currencyAffixIn(currency, language),
    check: (minor) => checkAmount(minor, { min, max, step }, show),
    move: (minor, count) =>
      isUndefined(step)
        ? clamp(minor + count * 10 ** digits, min ?? -Infinity, max ?? Infinity)
        : stepValue(minor, count, { min, max, step }),
    decimal: digits > 0,
    canonical: true,
  };
}
