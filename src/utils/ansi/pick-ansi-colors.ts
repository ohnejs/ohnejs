/**
 * A set of ANSI text stylers, one per color, weight, and style.
 * In the colored set each wraps its input in a Select Graphic Rendition pair.
 * In the plain set each returns its input untouched, so no codes are ever produced.
 */
export interface ANSIColors {
  /**
   * Tints `text` green.
   */
  green(text: string): string;

  /**
   * Tints `text` bright cyan.
   */
  cyan(text: string): string;

  /**
   * Tints `text` yellow.
   */
  yellow(text: string): string;

  /**
   * Tints `text` red.
   */
  red(text: string): string;

  /**
   * Tints `text` gray (bright black).
   */
  gray(text: string): string;

  /**
   * Sets `text` in bold.
   */
  bold(text: string): string;

  /**
   * Dims `text`.
   */
  dim(text: string): string;

  /**
   * Swaps the foreground and background colors of `text`.
   */
  inverse(text: string): string;
}

const wrap =
  (open: number, close: number) =>
  (text: string): string =>
    `\x1b[${open}m${text}\x1b[${close}m`;

const identity = (text: string): string => text;

const COLORED: ANSIColors = {
  green: wrap(32, 39),
  cyan: wrap(96, 39),
  yellow: wrap(33, 39),
  red: wrap(31, 39),
  gray: wrap(90, 39),
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  inverse: wrap(7, 27),
};

const PLAIN: ANSIColors = {
  green: identity,
  cyan: identity,
  yellow: identity,
  red: identity,
  gray: identity,
  bold: identity,
  dim: identity,
  inverse: identity,
};

/**
 * Selects the styler set to use.
 * Returns the colored set when `enabled`, otherwise the plain set whose stylers emit no codes.
 *
 * @example
 * ```ts
 * pickANSIColors(true).cyan('hi')  // -> '\x1b[96mhi\x1b[39m'
 * pickANSIColors(false).cyan('hi') // -> 'hi'
 * ```
 */
export function pickANSIColors(enabled: boolean): ANSIColors {
  return enabled ? COLORED : PLAIN;
}
