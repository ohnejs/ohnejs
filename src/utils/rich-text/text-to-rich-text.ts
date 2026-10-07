import type { RichText } from './rich-text.ts';

const CARRIAGE_RETURN = /\r\n?/g;
const BLANK_LINES = /\n\s*\n/;

/**
 * Reads plain text as a rich text value of paragraphs.
 * `\r\n` and `\r` become `\n`, a blank line ends a paragraph, and a single `\n` stays a line break.
 * Blank lines before the first paragraph and after the last are dropped, and `''` gives `[]`.
 * The text is never parsed as markdown.
 *
 * @example
 * ```ts
 * textToRichText('a\nb\r\n\r\nc')
 * // -> [
 * //   { kind: 'paragraph', content: [{ text: 'a\nb' }] },
 * //   { kind: 'paragraph', content: [{ text: 'c' }] },
 * // ]
 *
 * textToRichText('\n\n')
 * // -> []
 * ```
 */
export function textToRichText(text: string): RichText<never> {
  const lines = text.replace(CARRIAGE_RETURN, '\n');
  const start = lines.lastIndexOf('\n', lines.length - lines.trimStart().length - 1) + 1;
  const end = lines.indexOf('\n', lines.trimEnd().length);
  const trimmed = lines.slice(start, end === -1 ? lines.length : end);
  if (trimmed === '') return [];
  return trimmed
    .split(BLANK_LINES)
    .map((part) => ({ kind: 'paragraph', content: [{ text: part }] }));
}
