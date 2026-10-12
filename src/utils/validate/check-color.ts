import type { ValidationFailure } from './validation-failure.ts';

import { parseHexColor } from '../color/parse-hex-color.ts';

/**
 * Fails a value that is not a hex color, or one that is not fully opaque while `alpha` is off.
 * The failure is `validation.invalidColorAlpha` when `alpha` is on, else `validation.invalidColor`.
 *
 * @example
 * ```ts
 * checkColor('#ff8800', { alpha: false })   // -> undefined
 * checkColor('#ff880080', { alpha: false }) // -> 'validation.invalidColor'
 * checkColor('#ff880080', { alpha: true })  // -> undefined
 * checkColor('orange', { alpha: true })     // -> 'validation.invalidColorAlpha'
 * ```
 */
export function checkColor(
  value: string,
  options: { readonly alpha: boolean },
): ValidationFailure | undefined {
  const color = parseHexColor(value);
  if (options.alpha) return color ? undefined : 'validation.invalidColorAlpha';
  return color?.a === 255 ? undefined : 'validation.invalidColor';
}
