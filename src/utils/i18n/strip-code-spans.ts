import { codeSpanText } from '../ansi/code-span-text.ts';
import { codeSpans } from '../ansi/code-spans.ts';

/**
 * Replaces each backtick code span in `text` with the text it shows, leaving everything else as written.
 * Use it where a formatted message lands as plain text, such as a label or an `aria-label`.
 *
 * @example
 * ```ts
 * stripCodeSpans('Nothing found for `cats`')  // -> 'Nothing found for cats'
 * stripCodeSpans('Nothing found for ``a`b``') // -> 'Nothing found for a`b'
 * stripCodeSpans('`__init__` in __Drafts__')  // -> '__init__ in __Drafts__'
 * ```
 */
export function stripCodeSpans(text: string): string {
  let out = '';
  let cursor = 0;
  for (const [start, end] of codeSpans(text).ends) {
    out += text.slice(cursor, start) + codeSpanText(text.slice(start, end));
    cursor = end;
  }
  return out + text.slice(cursor);
}
