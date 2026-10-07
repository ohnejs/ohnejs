import type {
  RichText,
  RichTextBlock,
  RichTextList,
  RichTextListItem,
  RichTextOptions,
  RichTextRun,
} from './rich-text.ts';

import { mergeRuns } from './merge-runs.ts';
import { normalizeLink } from './normalize-link.ts';
import { sliceRuns } from './slice-runs.ts';

const CARRIAGE_RETURN = /\r\n?/g;
const CONTROL = /(?![\n\t])\p{Cc}/gu;

/**
 * Returns the canonical form of a rich text value, as a new tree.
 * Each list of runs goes through `mergeRuns` and each link through `normalizeLink`.
 * Text turns lone surrogates into U+FFFD, `\r\n` and `\r` into `\n`, and loses every other control but `\t`.
 * With `lineBreaks: false`, each `\n` becomes a space.
 * Text is NFC-composed after merging, and each leaf loses `\n` at its start and end, never spaces.
 * Empty list items, sublists and lists are dropped, and so are empty blocks at the end of the value.
 * Running it twice gives the same result.
 *
 * @example
 * ```ts
 * normalizeRichText([
 *   { kind: 'paragraph', content: [{ text: 'a\r\n' }, { text: 'b', marks: ['em', 'em'] }] },
 *   { kind: 'paragraph', content: [{ text: '\n' }] },
 * ])
 * // -> [{ kind: 'paragraph', content: [{ text: 'a\n' }, { text: 'b', marks: ['em'] }] }]
 * ```
 */
export function normalizeRichText<C extends string>(
  value: RichText<C>,
  { lineBreaks = true }: RichTextOptions = {},
): RichText<C> {
  const blocks = value.flatMap((block) => normalizeBlock(block, lineBreaks) ?? []);
  return blocks.slice(0, blocks.findLastIndex(hasContent) + 1);
}

/**
 * Normalizes a block, or returns `undefined` for a list left with no items.
 */
function normalizeBlock<C extends string>(
  block: RichTextBlock<C>,
  lineBreaks: boolean,
): RichTextBlock<C> | undefined {
  if (block.kind === 'list') return normalizeList(block, lineBreaks);
  const content = normalizeRuns(block.content, lineBreaks);
  if (block.kind === 'heading') return { kind: 'heading', level: block.level, content };
  return { kind: block.kind, content };
}

/**
 * Normalizes a list, or returns `undefined` when no item is left.
 */
function normalizeList<C extends string>(
  list: RichTextList<C>,
  lineBreaks: boolean,
): RichTextList<C> | undefined {
  const items = list.items.flatMap((item) => normalizeItem(item, lineBreaks) ?? []);
  return items.length > 0 ? { kind: 'list', ordered: list.ordered, items } : undefined;
}

/**
 * Normalizes a list item, or returns `undefined` when it holds neither runs nor a sublist.
 */
function normalizeItem<C extends string>(
  item: RichTextListItem<C>,
  lineBreaks: boolean,
): RichTextListItem<C> | undefined {
  const content = normalizeRuns(item.content, lineBreaks);
  const list = item.list && normalizeList(item.list, lineBreaks);
  if (list) return { content, list };
  return content.length > 0 ? { content } : undefined;
}

/**
 * Normalizes the runs of one leaf.
 * Runs merge before the text rules too, so a surrogate pair or `\r\n` split across equal runs survives.
 */
function normalizeRuns<C extends string>(
  runs: readonly RichTextRun<C>[],
  lineBreaks: boolean,
): RichTextRun<C>[] {
  const linked = runs.map((run) => (run.link ? { ...run, link: normalizeLink(run.link) } : run));
  const cleaned = mergeRuns(
    mergeRuns(linked).map((run) => ({ ...run, text: cleanText(run.text, lineBreaks) })),
  );
  const composed = cleaned.map((run) => ({ ...run, text: run.text.normalize('NFC') }));
  const text = composed.map((run) => run.text).join('');
  return sliceRuns(
    composed,
    text.length - text.replace(/^\n+/, '').length,
    text.replace(/\n+$/, '').length,
  );
}

/**
 * Applies the text rules that may change a run's length.
 */
function cleanText(text: string, lineBreaks: boolean): string {
  const clean = text.toWellFormed().replace(CARRIAGE_RETURN, '\n').replace(CONTROL, '');
  return lineBreaks ? clean : clean.replaceAll('\n', ' ');
}

/**
 * Whether a block keeps its place at the end of a value.
 */
function hasContent(block: RichTextBlock): boolean {
  return block.kind === 'list' || block.content.length > 0;
}
