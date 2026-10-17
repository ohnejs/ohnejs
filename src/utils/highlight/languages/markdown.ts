import type { HighlightToken } from '../highlight-token.ts';

import { scanTokens, type HighlightClassifier } from '../scan-tokens.ts';
import { captureGroup } from './_capture-group.ts';
import { embed, withEmbedded } from './_embed.ts';
import { tokenizeHTML } from './html.ts';

/**
 * Joins grammar parts into one alternation, a string part taken as regex source.
 */
function anyOf(parts: readonly (RegExp | string)[]): string {
  return parts.map((part) => (typeof part === 'string' ? part : part.source)).join('|');
}

const FRONT_MATTER = /(?<![\s\S])(---[ \t]*\n(?:[\s\S]*?\n)?(?:---|\.\.\.)[ \t]*(?![^\n]))/;

// `\2`, `\3` and `\7` count every group of GRAMMAR, so the parts keep their order.
const BACKTICK_FENCE = String.raw`(?=\`{3})(?<=(?:^|\n)[ \t]*)(\`{3,})[^\`\n]*(?![^\n])[\s\S]*?(?:\n[ \t]*\2\`*[ \t]*(?![^\n])|$)`;

const TILDE_FENCE = String.raw`(?=~{3})(?<=(?:^|\n)[ \t]*)(~{3,})[^\n]*[\s\S]*?(?:\n[ \t]*\3~*[ \t]*(?![^\n])|$)`;

const HTML_COMMENT = /(<!--[\s\S]*?(?:-->|$))/;

// A line after a list item or an indented line continues the list, so it never opens a block.
const INDENTED_CODE =
  /((?<=(?:^|(?:^|\n)[ \t]*\n)(?: {4}|\t)[ \t]*)(?<!(?:^|\n)(?:[ \t]+\S|(?:[-*+]|\d{1,9}[.)])[ \t])[^\n]*\n(?:[ \t]*\n)+[ \t]*)\S[^\n]*(?:(?:\n[ \t]*)*\n(?: {4}|\t)[^\n]*)*)/;

const BLOCK_MARKER = String.raw`(?<![^\s>])(${anyOf([
  /(?<=(?:^|\n) {0,3})#{1,6}(?![^\s])[^\n]*/,
  /(?<=(?:^|\n) {0,3})(?!(?:[-*+]|\d{1,9}[.)])(?![^\s])|>|`{3}|~{3})\S[^\n]*(?=\n {0,3}(?:=+|-+)[ \t]*(?![^\n]))/,
  /(?<=(?:^|\n) {0,3})(?:(?:\*[ \t]*){3,}|(?:_[ \t]*){3,}|(?:-[ \t]*)+)(?![^\n])/,
  /(?<=\S[ \t]*\n {0,3})=+[ \t]*(?![^\n])/,
  /(?<=(?:^|\n) {0,3})>(?:[ \t]*>)*/,
  /(?=[-*+\d])(?<=(?:^|\n)(?:[ \t]*>)*[ \t]*)(?:[-*+]|\d{1,9}[.)])(?![^\s])/,
  /(?=\[)(?<=(?:^|\n)(?:[ \t]*>)*[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+)\[[ xX]\](?![^\s])/,
])})`;

const CODE_SPAN = String.raw`(?<!\`)(\`{1,3})(?!\`)[^\n]*?(?<!\`)\7(?!\`)`;

const LINK_TEXT = /(!?\[[^[\]\n]*\](?=[([])|(?<=(?:^|\n) {0,3})\[[^[\]\n]+\](?=:))/;

const LINK_TARGET = `(${anyOf([
  /(?<=\])\((?:<[^<>\n]*>|[^\s()]*)(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?[ \t]*\)/,
  /(?<=\])\[[^[\]\n]*\]/,
  /(?<=(?:^|\n) {0,3}\[(?!\^)[^[\]\n]+\]:[ \t]*)\S+/,
  /<[A-Za-z][\w+.-]{1,31}:[^\s<>]*>/,
  /<[^\s<>@]+@[^\s<>@]+>/,
  /https?:\/\/[^\s<>]*[^\s<>.,:;"')\]*_~?!]/,
])})`;

const HTML_TAG = /(<\/?[A-Za-z][\w-]*(?![\w-])(?:[^<>\n"']|"[^"<\n]*"|'[^'<\n]*')*>)/;

const EMPHASIS =
  /(\*\*\*(?=[^\s*])[^*\n]*[^\s*]\*\*\*|(?<!\w)___(?=[^\s_])[^_\n]*[^\s_]___(?!\w)|\*\*(?=[^\s*])[^*\n]*[^\s*]\*\*|(?<!\w)__(?=[^\s_])[^_\n]*[^\s_]__(?!\w)|\*(?=[^\s*])[^*\n]*[^\s*]\*|(?<!\w)_(?=[^\s_])[^_\n]*[^\s_]_(?!\w)|~~(?=[^\s~])[^~\n]*[^\s~]~~)/;

const PLAIN = /\\[\s\S]|\w+|\s+|`+|~+|[^\s\w\\`*_~[\]!<]+|[\s\S]/;

const GRAMMAR = new RegExp(
  anyOf([
    FRONT_MATTER,
    BACKTICK_FENCE,
    TILDE_FENCE,
    HTML_COMMENT,
    INDENTED_CODE,
    BLOCK_MARKER,
    CODE_SPAN,
    LINK_TEXT,
    LINK_TARGET,
    HTML_TAG,
    EMPHASIS,
    PLAIN,
  ]),
  'y',
);

const KINDS = [
  'comment',
  'string',
  'string',
  'comment',
  'string',
  'keyword',
  'string',
  'function',
  'string',
  'tag',
  'variable',
] as const;

/**
 * Classifies each match by its group, but hands an inline HTML tag to the HTML tokenizer through `embedded`.
 */
function classifyMarkdown(embedded: HighlightToken[]): HighlightClassifier {
  return (match) => {
    const kind = KINDS[captureGroup(match) - 1];
    if (kind !== 'tag') return kind;
    embed(embedded, tokenizeHTML(match[0]), match.index);
    return undefined;
  };
}

/**
 * Tokenizes Markdown, CommonMark with the GitHub extensions.
 * Headings, setext underlines, rules, list and task markers and blockquotes are keywords.
 * Code spans, fenced and indented blocks, link targets and autolinks are strings; link text is a function.
 * Emphasis, strong and strikethrough are variables; HTML comments and front matter are comments.
 * An inline HTML tag that closes on its line is tokenized as HTML.
 * A fenced block stays one string and runs to the end when unclosed; inline spans never cross a line.
 *
 * @example
 * ```ts
 * tokenizeMarkdown('# Hi\n[a](b)')
 * // -> [
 * //   { kind: 'keyword', start: 0, end: 4 },
 * //   { kind: 'function', start: 5, end: 8 },
 * //   { kind: 'string', start: 8, end: 11 },
 * // ]
 * ```
 */
export function tokenizeMarkdown(code: string): HighlightToken[] {
  const embedded: HighlightToken[] = [];
  return withEmbedded(scanTokens(code, GRAMMAR, classifyMarkdown(embedded)), embedded);
}
