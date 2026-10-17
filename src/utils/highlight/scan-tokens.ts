import type { HighlightKind, HighlightToken } from './highlight-token.ts';

/**
 * Names the kind of one grammar match, or `undefined` to leave it plain.
 * `code` is the whole source, so a rule can look around the match.
 */
export type HighlightClassifier = (
  match: RegExpExecArray,
  code: string,
) => HighlightKind | undefined;

/**
 * Scans `code` in one left-to-right pass of a sticky (`y`) grammar and keeps the classified matches.
 * Every alternative of the grammar must consume at least one character.
 * The scan stops at the first position no alternative matches, so the rest stays plain.
 *
 * @example
 * ```ts
 * const grammar = /(#[^\n]*)|[^#]+/y
 * scanTokens('a # note', grammar, (match) => (match[1] ? 'comment' : undefined))
 * // -> [{ kind: 'comment', start: 2, end: 8 }]
 * ```
 */
export function scanTokens(
  code: string,
  grammar: RegExp,
  classify: HighlightClassifier,
): HighlightToken[] {
  const tokens: HighlightToken[] = [];
  grammar.lastIndex = 0;
  for (let match = grammar.exec(code); match?.[0]; match = grammar.exec(code)) {
    const kind = classify(match, code);
    if (kind) tokens.push({ kind, start: match.index, end: grammar.lastIndex });
  }
  return tokens;
}
