import type { RGBA } from './rgba.ts';

/**
 * Writes a color as lowercase `#rrggbb`, or `#rrggbbaa` when it is not fully opaque.
 * Every color has exactly one written form, so two spellings of one color compare equal.
 *
 * @example
 * ```ts
 * formatHexColor({ r: 255, g: 136, b: 0, a: 255 }) // -> '#ff8800'
 * formatHexColor({ r: 255, g: 136, b: 0, a: 128 }) // -> '#ff880080'
 * ```
 */
export function formatHexColor(color: RGBA): string {
  const channels =
    color.a === 255 ? [color.r, color.g, color.b] : [color.r, color.g, color.b, color.a];
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}
