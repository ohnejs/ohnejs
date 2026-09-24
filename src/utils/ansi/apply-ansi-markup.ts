import type { ANSIColors } from './pick-ansi-colors.ts';

import { isUndefined } from '../is/is-undefined.ts';

const MARKUP_PATTERN = new RegExp(
  [
    /`([^`\n]+)`/.source,
    /\*\*([^*\n]+)\*\*/.source,
    /(?<![A-Za-z0-9])__([^_\n]+)__(?![A-Za-z0-9])/.source,
  ].join('|'),
  'g',
);

/**
 * Applies inline markup to text: `__x__` dims, `**x**` bolds, and a backtick span highlights.
 * A backtick span holds no other markup.
 * Highlight renders cyan, or bold when `emphasize` is set.
 * Set `emphasize` when the surrounding text is already tinted, so the highlight still stands out.
 *
 * @example
 * ```ts
 * const color = pickANSIColors(true)
 * applyANSIMarkup('open `x` end', false, color) // -> 'open \x1b[96mx\x1b[39m end'
 * applyANSIMarkup('open `x` end', true, color)  // -> 'open \x1b[1mx\x1b[22m end'
 * ```
 */
export function applyANSIMarkup(text: string, emphasize: boolean, colors: ANSIColors): string {
  const highlight = emphasize ? colors.bold : colors.cyan;
  return text.replace(MARKUP_PATTERN, (_, code?: string, bold?: string, dim?: string) => {
    if (!isUndefined(code)) return highlight(code);
    if (!isUndefined(bold)) return colors.bold(applyANSIMarkup(bold, emphasize, colors));
    return colors.dim(applyANSIMarkup(dim!, emphasize, colors));
  });
}
