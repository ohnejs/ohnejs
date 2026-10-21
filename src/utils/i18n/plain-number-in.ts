import { decimalMarkIn } from './decimal-mark-in.ts';

/**
 * Writes `value` as `String` does, with `language`'s decimal mark, so it is never grouped or rounded.
 *
 * @example
 * ```ts
 * plainNumberIn(0.5, 'de')   // -> '0,5'
 * plainNumberIn(0.5, 'en')   // -> '0.5'
 * plainNumberIn(12345, 'de') // -> '12345'
 * ```
 */
export function plainNumberIn(value: number, language: string): string {
  const text = String(value);
  return text.includes('.') ? text.replace('.', decimalMarkIn(language)) : text;
}
