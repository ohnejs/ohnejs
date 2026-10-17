import type { HighlightToken } from '../highlight-token.ts';

/**
 * Appends `tokens` to `into`, shifted by `offset` from their own code into the document.
 *
 * @example
 * ```ts
 * const into: HighlightToken[] = []
 * embed(into, [{ kind: 'tag', start: 0, end: 2 }], 5)
 * into // -> [{ kind: 'tag', start: 5, end: 7 }]
 * ```
 */
export function embed(into: HighlightToken[], tokens: HighlightToken[], offset: number): void {
  for (const { kind, start, end } of tokens) {
    into.push({ kind, start: start + offset, end: end + offset });
  }
}

/**
 * Merges the tokens of embedded code into the document's own, in start order.
 *
 * @example
 * ```ts
 * withEmbedded([{ kind: 'tag', start: 4, end: 5 }], [{ kind: 'keyword', start: 0, end: 3 }])
 * // -> [{ kind: 'keyword', start: 0, end: 3 }, { kind: 'tag', start: 4, end: 5 }]
 * ```
 */
export function withEmbedded(
  tokens: HighlightToken[],
  embedded: HighlightToken[],
): HighlightToken[] {
  return embedded.length === 0
    ? tokens
    : [...tokens, ...embedded].sort((a, b) => a.start - b.start);
}
