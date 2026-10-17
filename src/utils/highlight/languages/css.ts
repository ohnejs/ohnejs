import type { HighlightToken } from '../highlight-token.ts';

import { scanTokens, type HighlightClassifier } from '../scan-tokens.ts';
import { captureGroup } from './_capture-group.ts';

const GRAMMAR =
  /(\/\*[\s\S]*?(?:\*\/|$))|("(?:[^"\\\n]|\\[\s\S])*"?|'(?:[^'\\\n]|\\[\s\S])*'?)|((?<=\burl\()[^\s'"()]+)|([+-]?(?:\d*\.\d+|\d+)(?:[eE][+-]?\d+)?(?:%|[A-Za-z]+)?)|(\.(?:[A-Za-z_\u0080-\uFFFF-]|\\[^\n])(?:[\w\u0080-\uFFFF-]|\\[^\n])*)|(#(?:[\w\u0080-\uFFFF-]|\\[^\n])+)|(@[\w-]+)|(!\s*important\b)|(--(?:[\w\u0080-\uFFFF-]|\\[^\n])*)|(-?(?:[A-Za-z_\u0080-\uFFFF]|\\[^\n])(?:[\w\u0080-\uFFFF-]|\\[^\n])*)|\s+|[\s\S]/y;

const SKIP =
  /[^;{}"'/\\]+|\\[\s\S]?|"(?:[^"\\\n]|\\[\s\S])*"?|'(?:[^'\\\n]|\\[\s\S])*'?|\/\*[\s\S]*?(?:\*\/|$)|\//y;

const COLON = /\s*:/y;

const OPERATORS = new Set(['and', 'not', 'only', 'or']);

/**
 * What the statement being scanned is: a selector before `{`, a declaration, or an at-rule prelude.
 */
type Statement = 'selector' | 'declaration' | 'rule';

/**
 * Whether the statement starting at `from` runs into `{` before `;`, `}` or the end.
 * Strings and comments are skipped whole, so a brace inside them never decides.
 */
function opensBlock(code: string, from: number): boolean {
  let at = from;
  for (SKIP.lastIndex = at; SKIP.exec(code); at = SKIP.lastIndex);
  return code.charAt(at) === '{';
}

/**
 * Each statement is classified once, at its first token, and holds until the next `;`, `{` or `}`.
 * In a selector's `[...]`, the first word is the attribute name and a word after `=` is its value.
 */
function classifyCSS(): HighlightClassifier {
  let statement: Statement | undefined;
  let valued = false;
  let bracket: 'name' | 'value' | undefined;
  return (match, code) => {
    const group = captureGroup(match);
    const text = match[0];
    if (group === 1) return 'comment';
    if (/^\s/.test(text)) return undefined;
    if (text === ';' || text === '{' || text === '}') {
      statement = undefined;
      return undefined;
    }
    if (!statement) {
      statement = group === 7 ? 'rule' : opensBlock(code, match.index) ? 'selector' : 'declaration';
      valued = false;
      bracket = undefined;
    }
    if (text === ':') valued = true;
    if (text === '[') bracket = 'name';
    if (text === ']') bracket = undefined;
    switch (group) {
      case 2:
      case 3:
        return 'string';
      case 4:
        return 'number';
      case 5:
        return statement === 'selector' ? 'attribute' : undefined;
      case 6:
        return statement === 'selector' ? 'attribute' : 'number';
      case 7:
      case 8:
        return 'keyword';
      case 9:
        return 'variable';
      case 10:
        if (statement === 'selector') return classifySelector(code, match.index);
        if (code.charAt(match.index + text.length) === '(') return 'function';
        if (statement === 'declaration') return valued ? undefined : 'property';
        COLON.lastIndex = match.index + text.length;
        if (COLON.test(code)) return 'property';
        return OPERATORS.has(text) ? 'keyword' : undefined;
      default:
        return undefined;
    }
  };

  function classifySelector(code: string, at: number) {
    if (bracket === 'name') {
      bracket = 'value';
      return 'attribute';
    }
    if (bracket === 'value') return code.charAt(at - 1) === '=' ? 'string' : undefined;
    return code.charAt(at - 1) === ':' ? 'type' : 'tag';
  }
}

/**
 * Tokenizes CSS.
 * In a selector, an element is a tag and a class or id is an attribute.
 * A pseudo-class or pseudo-element is a type.
 * In a declaration, the name is a property and a custom property is a variable.
 * A value's number, unit included, and hex color are numbers; a word before `(` is a function.
 * At-rules, their `and`, `not`, `only` and `or`, and `!important` are keywords.
 * An unterminated string ends at its line; an unterminated comment runs to the end.
 *
 * @example
 * ```ts
 * tokenizeCSS('a { color: red }')
 * // -> [{ kind: 'tag', start: 0, end: 1 }, { kind: 'property', start: 4, end: 9 }]
 * ```
 */
export function tokenizeCSS(code: string): HighlightToken[] {
  return scanTokens(code, GRAMMAR, classifyCSS());
}
