import type { RichTextRun } from './rich-text.ts';

/**
 * Returns the runs between two text offsets, cut at both ends, as a new list.
 * A run the range holds whole is kept as it is, and a run left without text is dropped.
 *
 * @example
 * ```ts
 * sliceRuns([{ text: 'ab' }, { text: 'cd', marks: ['em'] }], 1, 3)
 * // -> [{ text: 'b' }, { text: 'c', marks: ['em'] }]
 *
 * sliceRuns([{ text: 'ab' }, { text: 'cd', marks: ['em'] }], 2)
 * // -> [{ text: 'cd', marks: ['em'] }]
 * ```
 */
export function sliceRuns<C extends string>(
  runs: readonly RichTextRun<C>[],
  start: number,
  end = Infinity,
): RichTextRun<C>[] {
  const sliced: RichTextRun<C>[] = [];
  let offset = 0;
  for (const run of runs) {
    const text = run.text.slice(Math.max(start - offset, 0), Math.max(end - offset, 0));
    offset += run.text.length;
    if (text !== '') sliced.push(text === run.text ? run : { ...run, text });
  }
  return sliced;
}
