import { minorUnitsToDecimal } from '../number/minor-units-to-decimal.ts';
import { formatNumberIn } from './format-number-in.ts';

/**
 * The text a user edits for an amount in minor units: `language`'s decimal mark, no grouping, ASCII digits.
 * The mark is `,` where the language writes a comma, else `.`, the two that `parseMinorUnits` reads.
 * A negative amount leads with an ASCII `-`, not the language's own minus or a direction mark.
 *
 * @example
 * ```ts
 * amountEditText(123450, 2, 'de')    // -> '1234,50'
 * amountEditText(123450, 2, 'ar-EG') // -> '1234.50'
 * amountEditText(1234, 0, 'en')      // -> '1234'
 * ```
 */
export function amountEditText(minor: number, digits: number, language: string): string {
  const text = minorUnitsToDecimal(minor, digits);
  const comma = formatNumberIn(0.5, language, { numberingSystem: 'latn' }).includes(',');
  return comma ? text.replace('.', ',') : text;
}
