import { minorUnitsToDecimal } from '../number/minor-units-to-decimal.ts';
import { formatNumberIn } from './format-number-in.ts';

/**
 * The text a user edits for an amount in minor units: `language`'s decimal mark, no grouping, ASCII digits.
 * A negative amount leads with an ASCII `-`, not the language's own minus or a direction mark.
 * It reads back through `parseMinorUnits` unchanged, whatever the language's own digits are.
 *
 * @example
 * ```ts
 * amountEditText(123450, 2, 'de')    // -> '1234,50'
 * amountEditText(123450, 2, 'ar-EG') // -> '1234.50'
 * amountEditText(1234, 0, 'en')      // -> '1234'
 * ```
 */
export function amountEditText(minor: number, digits: number, language: string): string {
  const sign = minor < 0 ? '-' : '';
  return (
    sign +
    formatNumberIn(minorUnitsToDecimal(Math.abs(minor), digits), language, {
      numberingSystem: 'latn',
      useGrouping: false,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })
  );
}
