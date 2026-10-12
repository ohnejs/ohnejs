import type { RGBA } from './rgba.ts';

const HEX_COLOR = /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i;

/**
 * Reads a CSS hex color in any case: `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`.
 * Returns `undefined` for anything else, named colors included.
 *
 * @example
 * ```ts
 * parseHexColor('#f80')      // -> { r: 255, g: 136, b: 0, a: 255 }
 * parseHexColor('#FF880080') // -> { r: 255, g: 136, b: 0, a: 128 }
 * parseHexColor('orange')    // -> undefined
 * ```
 */
export function parseHexColor(value: string): RGBA | undefined {
  if (!HEX_COLOR.test(value)) return undefined;
  const digits = value.slice(1);
  const pairs =
    digits.length <= 4 ? [...digits].map((digit) => digit + digit) : digits.match(/../g)!;
  const [r, g, b, a = 255] = pairs.map((pair) => Number.parseInt(pair, 16));
  return { r, g, b, a };
}
