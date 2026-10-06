import type { RichText } from './rich-text.ts';

import { isUndefined } from '../is/is-undefined.ts';
import { leaves } from './_read.ts';

/**
 * Renders a rich text value as plain text: run text as it is, without its marks and links.
 * Blocks are joined with a blank line, and each list item sits on its own line.
 * `[]` gives `''`.
 *
 * @example
 * ```ts
 * richTextToText([
 *   { kind: 'heading', level: 2, content: [{ text: 'Hi' }] },
 *   { kind: 'list', ordered: false, items: [{ content: [{ text: 'a' }] }, { content: [{ text: 'b' }] }] },
 * ])
 * // -> 'Hi\n\na\nb'
 * ```
 */
export function richTextToText(value: RichText): string {
  let text = '';
  let last: number | undefined;
  for (const { block, runs } of leaves(value)) {
    if (!isUndefined(last)) text += block === last ? '\n' : '\n\n';
    text += runs.map((run) => run.text).join('');
    last = block;
  }
  return text;
}
