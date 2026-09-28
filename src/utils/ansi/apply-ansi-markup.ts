import type { ANSIColors } from './pick-ansi-colors.ts';

import { isUndefined } from '../is/is-undefined.ts';
import { isPadded } from './_padded.ts';

const MARKUP_PATTERN = new RegExp(
  [
    /(?<!`)(`+)(?!`)([^\n]+?)(?<!`)\1(?!`)/.source,
    /(?<!\S)\*\*(?!\s)([^\n]+?)(?<!\s)\*\*(?!\S)/.source,
    /(?<!\S)__(?!\s)([^\n]+?)(?<!\s)__(?!\S)/.source,
  ].join('|'),
  'g',
);

/**
 * Applies inline markup to text: `__x__` dims, `**x**` bolds, and a backtick span highlights.
 * A backtick span holds no other markup.
 * As in Markdown, a span closes only at a backtick run of its own length and drops one padding space per side.
 * A `__` or `**` pair opens at a word start and closes at a word end, both at whitespace or a line edge.
 * Highlight renders cyan, or bold when `emphasize` is set.
 * Set `emphasize` when the surrounding text is already tinted, so the highlight still stands out.
 *
 * @example
 * ```ts
 * const color = pickANSIColors(true)
 * applyANSIMarkup('open `x` end', false, color)     // -> 'open \x1b[96mx\x1b[39m end'
 * applyANSIMarkup('open `x` end', true, color)      // -> 'open \x1b[1mx\x1b[22m end'
 * applyANSIMarkup('open ``a`b`` end', false, color) // -> 'open \x1b[96ma`b\x1b[39m end'
 * ```
 */
export function applyANSIMarkup(text: string, emphasize: boolean, colors: ANSIColors): string {
  const highlight = emphasize ? colors.bold : colors.cyan;
  return text.replace(MARKUP_PATTERN, (_, _fence, code?: string, bold?: string, dim?: string) => {
    if (!isUndefined(code)) return highlight(isPadded(code) ? code.slice(1, -1) : code);
    if (!isUndefined(bold)) return colors.bold(applyANSIMarkup(bold, emphasize, colors));
    return colors.dim(applyANSIMarkup(dim!, emphasize, colors));
  });
}
