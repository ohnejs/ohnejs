import type { HighlightToken } from '../highlight-token.ts';

import { scanTokens, type HighlightClassifier } from '../scan-tokens.ts';
import { captureGroup } from './_capture-group.ts';

const KEYWORDS = new Set(
  `import export from default const let var function return await async if else for of in new
   class interface type extends implements declare module throw try catch finally typeof instanceof
   as satisfies readonly keyof void yield while switch case break continue true false null undefined
   this super delete`.split(/\s+/),
);

const GRAMMAR =
  /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|('(?:[^'\\\n]|\\.)*'?|"(?:[^"\\\n]|\\.)*"?|`(?:[^`\\]|\\[\s\S])*`?)|(0[xX][\da-fA-F_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)|([A-Za-z_$][\w$]*)|\s+|[^\s\w$'"`/]+|\//y;

const CAPITALIZED = /^[A-Z]/;

/**
 * A word after a member access `.` is a member, never a keyword.
 * A capitalized word is a type; a word right before `(` is a function.
 */
const classify: HighlightClassifier = (match, code) => {
  switch (captureGroup(match)) {
    case 1:
      return 'comment';
    case 2:
      return 'string';
    case 3:
      return 'number';
    case 4: {
      const word = match[0];
      if (KEYWORDS.has(word) && !isMember(code, match.index)) return 'keyword';
      if (CAPITALIZED.test(word)) return 'type';
      if (code.charAt(match.index + word.length) === '(') return 'function';
      return undefined;
    }
    default:
      return undefined;
  }
};

/**
 * Whether the word at `at` follows a member access dot, never the last dot of a spread.
 */
function isMember(code: string, at: number): boolean {
  return code.charAt(at - 1) === '.' && code.charAt(at - 2) !== '.';
}

/**
 * Tokenizes TypeScript and JavaScript.
 * An unterminated string ends at its line; an unterminated template or block comment runs to the end.
 *
 * @example
 * ```ts
 * tokenizeTS('const n = 1')
 * // -> [{ kind: 'keyword', start: 0, end: 5 }, { kind: 'number', start: 10, end: 11 }]
 * ```
 */
export function tokenizeTS(code: string): HighlightToken[] {
  return scanTokens(code, GRAMMAR, classify);
}
