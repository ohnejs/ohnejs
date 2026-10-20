import { minorUnitsToDecimal } from '../number/minor-units-to-decimal.ts';
import { decimalMarkIn } from './decimal-mark-in.ts';

/**
 * The text a user edits for an amount in minor units: `language`'s decimal mark, no grouping, ASCII digits.
 * The mark is the one `decimalMarkIn` names, so the text reads back through `parseMinorUnits`.
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
  return minorUnitsToDecimal(minor, digits).replace('.', decimalMarkIn(language));
}
