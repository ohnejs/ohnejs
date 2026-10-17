import type { HighlightToken } from '../highlight-token.ts';

import { scanTokens } from '../scan-tokens.ts';
import { classifyGroups } from './_capture-group.ts';

const GRAMMAR = /(#[^\n]*)|[^\n]+|\n/y;

const classify = classifyGroups(['comment']);

/**
 * Tokenizes `.gitignore` patterns.
 * A line starting with `#` is a comment; a pattern stays plain.
 *
 * @example
 * ```ts
 * tokenizeGitignore('# deps\nnode_modules')
 * // -> [{ kind: 'comment', start: 0, end: 6 }]
 * ```
 */
export function tokenizeGitignore(code: string): HighlightToken[] {
  return scanTokens(code, GRAMMAR, classify);
}
