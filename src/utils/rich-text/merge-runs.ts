import type { RichTextMark, RichTextRun } from './rich-text.ts';

import { deepEqual } from '../object/deep-equal.ts';
import { RICH_TEXT_MARKS } from './rich-text.ts';

/**
 * Returns the structural canonical form of a list of runs, as new runs.
 * It drops runs with empty text, and merges neighbours whose marks and link are equal.
 * Marks are deduped and sorted by `RICH_TEXT_MARKS`, and an empty mark list is dropped.
 * The text itself never changes, so it is cheap enough to run on every keystroke.
 *
 * @example
 * ```ts
 * mergeRuns([{ text: 'a', marks: ['em', 'em'] }, { text: '' }, { text: 'b', marks: ['em'] }])
 * // -> [{ text: 'ab', marks: ['em'] }]
 *
 * mergeRuns([{ text: 'a', marks: ['em', 'strong'] }])
 * // -> [{ text: 'a', marks: ['strong', 'em'] }]
 *
 * mergeRuns([{ text: 'a', marks: [] }, { text: 'b', link: { url: '/b' } }])
 * // -> [{ text: 'a' }, { text: 'b', link: { url: '/b' } }]
 * ```
 */
export function mergeRuns<C extends string>(runs: readonly RichTextRun<C>[]): RichTextRun<C>[] {
  const merged: RichTextRun<C>[] = [];
  for (const { text, marks = [], link } of runs) {
    if (text === '') continue;
    const sorted: RichTextMark[] = RICH_TEXT_MARKS.filter((mark) => marks.includes(mark));
    const last = merged.at(-1);
    if (last && deepEqual(last.marks ?? [], sorted) && deepEqual(last.link, link)) {
      last.text += text;
    } else {
      merged.push({
        text,
        ...(sorted.length > 0 ? { marks: sorted } : {}),
        ...(link ? { link } : {}),
      });
    }
  }
  return merged;
}
