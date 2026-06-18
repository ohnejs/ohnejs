import type { ANSIColors } from './pick-ansi-colors.ts';

const DIM_PATTERN = /(?<![A-Za-z0-9])__([^_\n]+)__(?![A-Za-z0-9])/g;
const BOLD_PATTERN = /\*\*([^*\n]+)\*\*/g;
const HIGHLIGHT_PATTERN = /`([^`\n]+)`/g;

/**
 * Applies inline markup to text: `__x__` dims, `**x**` bolds, and a backtick span highlights.
 * Highlight renders cyan, or bold when `emphasize` is set.
 * Set `emphasize` when the surrounding text is already tinted, so the highlight still stands out.
 *
 * @example
 * ```ts
 * const color = pickANSIColors(true)
 * applyANSIMarkup('open `x` end', false, color) // -> 'open \x1b[36mx\x1b[39m end'
 * applyANSIMarkup('open `x` end', true, color)  // -> 'open \x1b[1mx\x1b[22m end'
 * ```
 */
export function applyANSIMarkup(text: string, emphasize: boolean, colors: ANSIColors): string {
  const highlight = emphasize ? colors.bold : colors.cyan;
  return text
    .replace(DIM_PATTERN, (_, inner: string) => colors.dim(inner))
    .replace(BOLD_PATTERN, (_, inner: string) => colors.bold(inner))
    .replace(HIGHLIGHT_PATTERN, (_, inner: string) => highlight(inner));
}
