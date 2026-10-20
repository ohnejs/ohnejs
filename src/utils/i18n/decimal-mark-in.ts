import { formatNumberIn } from './format-number-in.ts';

/**
 * The decimal mark a user types in `language`: `,` where the language writes a comma, else `.`.
 * These are the two marks `parseMinorUnits` and a real-number parse read.
 *
 * @example
 * ```ts
 * decimalMarkIn('de')    // -> ','
 * decimalMarkIn('de-CH') // -> '.'
 * decimalMarkIn('ar-EG') // -> '.'
 * ```
 */
export function decimalMarkIn(language: string): ',' | '.' {
  return formatNumberIn(0.5, language, { numberingSystem: 'latn' }).includes(',') ? ',' : '.';
}
