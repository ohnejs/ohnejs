import type { HighlightToken } from '../highlight-token.ts';

import { scanTokens, type HighlightClassifier } from '../scan-tokens.ts';
import { captureGroup } from './_capture-group.ts';

const GRAMMAR =
  /(<!--[\s\S]*?(?:-->|$))|(<!\[CDATA\[[\s\S]*?(?:\]\]>|$))|(<\?[\s\S]*?(?:\?>|$)|<![A-Za-z][^<>[]*>?)|(<\/?[A-Za-z_:][\w.:-]*)|\s+|(\/?>)|(?=["'])(?<==\s*)("[^"<]*"?|'[^'<]*'?)|(&(?:#\d+|#[xX][\da-fA-F]+|[A-Za-z_:][\w.:-]*);)|([A-Za-z_:][\w.:-]*)|[^\s<>&"'=/]+|[\s\S]/y;

const KINDS = [
  'comment',
  'string',
  'keyword',
  'tag',
  'tag',
  'string',
  'variable',
  'attribute',
] as const;

/**
 * A name inside a tag is an attribute, and only a tag closes at `>`.
 * Outside a tag, names, quotes and `>` are plain text.
 */
function classifyXML(): HighlightClassifier {
  let inTag = false;
  return (match) => {
    const group = captureGroup(match);
    if (group === 4) inTag = true;
    else if (group > 0 && group <= 3) inTag = false;
    else if (!inTag && (group === 5 || group === 6 || group === 8)) return undefined;
    else if (group === 5) inTag = false;
    return KINDS[group - 1];
  };
}

/**
 * Tokenizes XML and its dialects, SVG included.
 * A tag's name with its `<` or `</` is a tag, and so is its closing `>` or `/>`.
 * An attribute value is a string, and so is a CDATA section.
 * A processing instruction and a `<!DOCTYPE>` or other declaration are keywords, an entity is a variable.
 * An unterminated value ends before the next `<`.
 * An unterminated comment, CDATA or instruction runs to the end.
 *
 * @example
 * ```ts
 * tokenizeXML('<a x="1"/>')
 * // -> [
 * //   { kind: 'tag', start: 0, end: 2 },
 * //   { kind: 'attribute', start: 3, end: 4 },
 * //   { kind: 'string', start: 5, end: 8 },
 * //   { kind: 'tag', start: 8, end: 10 },
 * // ]
 * ```
 */
export function tokenizeXML(code: string): HighlightToken[] {
  return scanTokens(code, GRAMMAR, classifyXML());
}
