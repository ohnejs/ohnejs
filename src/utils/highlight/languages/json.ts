import type { HighlightToken } from '../highlight-token.ts';

import { scanTokens } from '../scan-tokens.ts';
import { classifyGroups } from './_capture-group.ts';

const GRAMMAR =
  /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|("(?:[^"\\\n]|\\.)*"(?=\s*:))|("(?:[^"\\\n]|\\.)*"?)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(\b(?:true|false|null)\b)|\s+|[^\s"\w/-]+|[\s\S]/y;

const classify = classifyGroups(['comment', 'property', 'string', 'number', 'keyword']);

/**
 * Tokenizes JSON, and JSONC with its `//` and `/* *\/` comments.
 * A string followed by `:` is a property.
 *
 * @example
 * ```ts
 * tokenizeJSON('{"a": 1}')
 * // -> [{ kind: 'property', start: 1, end: 4 }, { kind: 'number', start: 6, end: 7 }]
 * ```
 */
export function tokenizeJSON(code: string): HighlightToken[] {
  return scanTokens(code, GRAMMAR, classify);
}
