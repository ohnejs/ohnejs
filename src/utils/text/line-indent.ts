import { lineStart } from './_lines.ts';

/**
 * The leading spaces and tabs of the line holding offset `at`, up to `at`.
 * An offset inside the indent cuts it there, so a newline typed there never doubles it.
 *
 * @example
 * ```ts
 * lineIndent('a\n  b', 5)  // -> '  '
 * lineIndent('a\n\t\tb', 1) // -> ''
 * lineIndent('    b', 2)   // -> '  '
 * ```
 */
export function lineIndent(text: string, at: number): string {
  const from = lineStart(text, at);
  let to = from;
  while (to < at && (text[to] === ' ' || text[to] === '\t')) to += 1;
  return text.slice(from, to);
}
