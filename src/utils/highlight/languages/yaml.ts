import type { HighlightToken } from '../highlight-token.ts';

import { scanTokens, type HighlightClassifier } from '../scan-tokens.ts';
import { captureGroup } from './_capture-group.ts';

const GRAMMAR =
  /(?<=(?:^|\n)(?!\1)(?:(?:[^\n#]*:|(?:[^\n#]*[ \t])?(?:[?-]|---|[!&]\S*))[ \t]+)?[|>][1-9+-]{0,2}(?:[ \t]+#[^\n#|>]*)?[ \t]*\n(?:[ \t]*\n)*([ \t]+))\S[^\n]*(?:\n(?:[ \t]*\n)*\1[^\n]*)*|((?<!\S)#[^\n]*)|((?<![^\n])(?:(?:---|\.\.\.)(?!\S)|%\S+))|("(?:[^"\\\n]|\\.|\\?\n(?=[ \t]*\n|[ \t]))*"?|'(?:[^'\n]|''|\n(?=[ \t]*\n|[ \t]))*'?)|([&*][^\s,[\]{}]+)|(![^\s,[\]{}]*)|([|>][1-9+-]{0,2}(?=[ \t]*(?:#|\n|$)))|((?:[^\s\-?:,[\]{}#&*!|>'"%@`]|[-?:](?=[^\s,[\]{}]))(?:[^\s:,[\]{}]|:(?=[^\s,[\]{}])|[ \t]+(?=[^\s#:,[\]{}]|:[^\s,[\]{}]))*)|\s+|[\s\S]/y;

const KEYWORDS = new Set(
  `true True TRUE false False FALSE null Null NULL ~ yes Yes YES no No NO on On ON off Off OFF`.split(
    ' ',
  ),
);

const NUMBER =
  /^(?:[-+]?(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][-+]?\d+)?|0x[\da-fA-F_]+|0o[0-7_]+|0b[01_]+|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/;

const QUOTED_KEY_END = /[ \t]*:/y;

const PLAIN_KEY_END = /[ \t]*:(?![^\s,[\]{}])/y;

/**
 * A scalar followed by `:` is a mapping key.
 * A quoted key may meet its `:` directly, as in JSON.
 * A plain key needs a space, a line end or a flow bracket after its `:`.
 */
const classify: HighlightClassifier = (match, code) => {
  switch (captureGroup(match)) {
    case 1:
      return 'string';
    case 2:
      return 'comment';
    case 3:
    case 7:
      return 'keyword';
    case 4:
      return followedBy(QUOTED_KEY_END, code, match) ? 'property' : 'string';
    case 5:
      return 'variable';
    case 6:
      return 'type';
    case 8: {
      const scalar = match[0];
      if (followedBy(PLAIN_KEY_END, code, match)) return 'property';
      if (NUMBER.test(scalar)) return 'number';
      return KEYWORDS.has(scalar) ? 'keyword' : undefined;
    }
    default:
      return undefined;
  }
};

/**
 * Whether the sticky `pattern` matches right after `match`.
 */
function followedBy(pattern: RegExp, code: string, match: RegExpExecArray): boolean {
  pattern.lastIndex = match.index + match[0].length;
  return pattern.test(code);
}

/**
 * Tokenizes YAML.
 * A mapping key is a property, an anchor or alias a variable, a tag a type.
 * A block scalar's content, indented under its `|` or `>` line, is one string.
 * A quoted string continues over indented or blank lines.
 * An unterminated one ends at the next unindented line.
 *
 * @example
 * ```ts
 * tokenizeYAML('port: 80')
 * // -> [{ kind: 'property', start: 0, end: 4 }, { kind: 'number', start: 6, end: 8 }]
 * ```
 */
export function tokenizeYAML(code: string): HighlightToken[] {
  return scanTokens(code, GRAMMAR, classify);
}
