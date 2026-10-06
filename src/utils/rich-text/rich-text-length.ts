import type { RichText } from './rich-text.ts';

import { leaves } from './_read.ts';

/**
 * Counts the UTF-16 code units of run text in a rich text value, as `text.length` counts them.
 * A `\n` counts as 1, and a block boundary as 0.
 *
 * @example
 * ```ts
 * richTextLength([{ kind: 'paragraph', content: [{ text: 'a\nb' }, { text: 'c', marks: ['em'] }] }])
 * // -> 4
 *
 * richTextLength([])
 * // -> 0
 * ```
 */
export function richTextLength(value: RichText): number {
  return leaves(value)
    .flatMap((leaf) => leaf.runs)
    .reduce((sum, run) => sum + run.text.length, 0);
}
