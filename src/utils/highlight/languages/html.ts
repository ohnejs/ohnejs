import type { HighlightToken } from '../highlight-token.ts';

import { lowercase } from '../../case/lowercase.ts';
import { scanTokens, type HighlightClassifier } from '../scan-tokens.ts';
import { captureGroup } from './_capture-group.ts';
import { embed, withEmbedded } from './_embed.ts';
import { tokenizeCSS } from './css.ts';
import { tokenizeJSON } from './json.ts';
import { tokenizeTS } from './ts.ts';

/**
 * Builds the grammar, matching each element that `elements` names together with its raw body.
 */
function markup(elements: string): RegExp {
  return new RegExp(
    String.raw`(<!--[\s\S]*?(?:-->|$))|(<!\[CDATA\[[\s\S]*?(?:\]\]>|$))|(<\?[\s\S]*?(?:\?>|$)|<![A-Za-z][^<>[]*>?)|(<(${elements})(?![^\s/>])(?:[^<>"']|"[^"<]*"|'[^'<]*')*>)((?:(?!<\/\5(?![^\s/>]))[\s\S])+)|(<\/?[A-Za-z][^\s/<>]*)|\s+|(\/?>)|(?<==\s*)("[^"]*"(?=[\s/>]|$)|'[^']*'(?=[\s/>]|$)|"[^"<]*"?|'[^'<]*'?|[^\s"'=<>\`]+)|(&(?:#\d+|#x[\da-f]+|[a-z][\da-z]*);)|([^\s"'<>/=&]+)|[\s\S]`,
    'iy',
  );
}

const GRAMMAR = markup('script|style');

// A data block's body ends at the first `</script`, so a `<script>` inside it never closes.
const DATA_BLOCK_GRAMMAR = markup('style');

const KINDS = [
  'comment',
  'string',
  'keyword',
  undefined,
  undefined,
  undefined,
  'tag',
  'tag',
  'string',
  'variable',
  'attribute',
] as const;

const SCRIPT_TYPE = /\stype\s*=\s*["']?([^\s"'>]*)/i;

const JSON_TYPE = /json|importmap|speculationrules/;

const JS_TYPE =
  /^(?:module|(?:text|application)\/(?:x-)?(?:java|ecma|type)script|text\/(?:babel|jsx))?$/;

/**
 * A name inside a tag is an attribute, and only a tag closes at `>`.
 * Outside a tag, names, quotes, values and `>` are plain text.
 * A `<script>` or `<style>` start tag and its content are one match, tokenized into `embedded`.
 */
function classifyHTML(embedded: HighlightToken[]): HighlightClassifier {
  let inTag = false;
  return (match) => {
    const group = captureGroup(match);
    if (group === 4) {
      const [, , , , start = '', name = '', content = ''] = match;
      const tokenizer = lowercase(name) === 'style' ? tokenizeCSS : scriptTokenizer(start);
      embed(embedded, tokenizeHTML(start), match.index);
      embed(embedded, tokenizer(content), match.index + start.length);
      inTag = false;
      return undefined;
    }
    if (group === 7) inTag = true;
    else if (group > 0 && group <= 3) inTag = false;
    else if (!inTag && (group === 8 || group === 9 || group === 11)) return undefined;
    else if (group === 8) inTag = false;
    return KINDS[group - 1];
  };
}

/**
 * Picks the tokenizer for a `<script>` body by its `type`.
 * An absent or JavaScript `type` is TypeScript, one naming JSON or an import map is JSON.
 * Any other `type` is a data block, most often a template, so it reads as HTML.
 */
function scriptTokenizer(startTag: string): (code: string) => HighlightToken[] {
  const type = lowercase(SCRIPT_TYPE.exec(startTag)?.[1] ?? '');
  if (JSON_TYPE.test(type)) return tokenizeJSON;
  return JS_TYPE.test(type) ? tokenizeTS : tokenizeDataBlock;
}

/**
 * Tokenizes a `<script>` data block's body as HTML, a nested `<script>` read as a plain tag.
 */
function tokenizeDataBlock(code: string): HighlightToken[] {
  return scanMarkup(code, DATA_BLOCK_GRAMMAR);
}

/**
 * Scans markup with a fresh copy of `grammar`, so an embedded scan never moves an outer one.
 */
function scanMarkup(code: string, grammar: RegExp): HighlightToken[] {
  const embedded: HighlightToken[] = [];
  return withEmbedded(scanTokens(code, new RegExp(grammar), classifyHTML(embedded)), embedded);
}

/**
 * Tokenizes HTML and XHTML.
 * A tag's name with its `<` or `</` is a tag, and so is its closing `>` or `/>`.
 * An attribute value, quoted or not, is a string, and so is a CDATA section.
 * A `<!DOCTYPE>`, another declaration or a processing instruction is a keyword; an entity is a variable.
 * A `<style>` body is tokenized as CSS.
 * A `<script>` body is TypeScript, JSON when its `type` says so, and HTML for a non-JavaScript `type`.
 * An unterminated value ends before the next `<`.
 * An unterminated comment, CDATA or `<script>` runs to the end.
 *
 * @example
 * ```ts
 * tokenizeHTML('<a href=x>&amp;</a>')
 * // -> [
 * //   { kind: 'tag', start: 0, end: 2 },
 * //   { kind: 'attribute', start: 3, end: 7 },
 * //   { kind: 'string', start: 8, end: 9 },
 * //   { kind: 'tag', start: 9, end: 10 },
 * //   { kind: 'variable', start: 10, end: 15 },
 * //   { kind: 'tag', start: 15, end: 18 },
 * //   { kind: 'tag', start: 18, end: 19 },
 * // ]
 * ```
 */
export function tokenizeHTML(code: string): HighlightToken[] {
  return scanMarkup(code, GRAMMAR);
}
