import type { CurrencyCode } from '../../../utils/index.ts';

import {
  checkAmount,
  checkRange,
  checkStep,
  currencyDigits,
  isCurrencyCode,
  isInteger,
  isUndefined,
  minorUnitsToDecimal,
  parseMinorUnits,
} from '../../../utils/index.ts';
import { boundsProblem } from '../bounds.ts';
import { defineField } from '../define-field.ts';
import { numericOptions, numericOptionsProblem } from '../numeric.ts';
import { option } from '../option.ts';
import { failureMessage } from '../validation-message.ts';

/**
 * The built-in `integer` field type: a whole number within JavaScript's safe integer range.
 * With a `currency` the value is an amount in that currency's minor units, so `1234` in `EUR` is 12.34 €.
 * Search is off until a field sets `search: true`.
 * Then an integer token matches the equal value, or with a `currency` an amount like `12,34` does.
 */
export const integer = defineField({
  columnType: 'integer',
  options: {
    ...numericOptions,

    /**
     * The ISO 4217 currency the value counts in, as minor units: `1234` with `EUR` is 12.34 €.
     * `min` and `max` count minor units too.
     * The dashboard reads and writes the amount in major units, formatted for the viewer's language.
     * Changing it reinterprets every stored value, so `1234` in `EUR` would read as ¥1,234 in `JPY`.
     */
    currency: option<CurrencyCode>(),
  },
  validateOptions: ({ options }) =>
    boundsProblem(options) ??
    currencyProblem(options) ??
    numericOptionsProblem(options, { whole: true }),
  validators: [
    (value, ctx) => {
      const { currency } = ctx.options;
      if (isUndefined(currency)) {
        return failureMessage(checkRange(value, ctx.options) ?? checkStep(value, ctx.options));
      }
      const show = (minor: number): string =>
        `${minorUnitsToDecimal(minor, currencyDigits[currency])} ${currency}`;
      return failureMessage(checkAmount(value, ctx.options, show));
    },
  ],
  search: {
    default: false,
    match: ({ token, options }) => {
      const value = isUndefined(options.currency)
        ? /^[+-]?\d+$/.test(token)
          ? Number(token)
          : undefined
        : parseMinorUnits(token, currencyDigits[options.currency]);
      return isInteger(value) ? { equalsTo: value } : null;
    },
  },
});

/**
 * What makes a field's `currency` unusable, as error body rows, or `undefined` when it holds.
 * Its bounds count whole minor units.
 * An amount reads in its currency, so it takes no unit `suffix`, `step` grid, or slider.
 */
function currencyProblem(options: {
  currency?: string;
  min?: number;
  max?: number;
  step?: number;
  suffix?: unknown;
  display: 'input' | 'slider';
}): string[] | undefined {
  const { currency } = options;
  if (isUndefined(currency)) return undefined;
  if (!isCurrencyCode(currency)) {
    return [
      `\`currency\` is \`${String(currency)}\`, which is no ISO 4217 currency.`,
      'Use an upper-case code of a circulating currency, like `EUR`.',
    ];
  }
  const fractional = (['min', 'max'] as const).find(
    (key) => !isUndefined(options[key]) && !isInteger(options[key]),
  );
  if (!isUndefined(fractional)) {
    return [
      `\`${fractional}\` is \`${options[fractional]}\`, but \`currency\` counts whole minor units.`,
      `Write \`${fractional}\` in minor units, like \`1999\` for 19.99.`,
    ];
  }
  const clash =
    (['suffix', 'step'] as const).find((key) => !isUndefined(options[key])) ??
    (options.display === 'slider' ? "display: 'slider'" : undefined);
  if (isUndefined(clash)) return undefined;
  return [
    `\`currency\` and \`${clash}\` cannot meet: an amount reads in its currency.`,
    `Drop \`${clash}\`.`,
  ];
}
