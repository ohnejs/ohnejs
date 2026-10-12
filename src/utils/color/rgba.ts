/**
 * A color as its red, green, blue and alpha channels, each an integer from `0` to `255`.
 * An alpha of `255` is fully opaque.
 *
 * @example
 * ```ts
 * const orange: RGBA = { r: 255, g: 136, b: 0, a: 255 }
 * ```
 */
export interface RGBA {
  /**
   * The red channel.
   */
  r: number;

  /**
   * The green channel.
   */
  g: number;

  /**
   * The blue channel.
   */
  b: number;

  /**
   * The alpha channel, `255` for fully opaque.
   */
  a: number;
}
