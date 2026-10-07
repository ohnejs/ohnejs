import type { RichTextBlock, RichTextList, RichTextRun } from './rich-text.ts';

import { intersperse } from '../array/intersperse.ts';

/**
 * Joins the runs of every leaf in `blocks` into one list, with an unmarked `separator` run between leaves.
 * A list contributes each item's runs in document order, so nested items follow their parent.
 *
 * @example
 * ```ts
 * flattenRichText(
 *   [
 *     { kind: 'heading', level: 2, content: [{ text: 'Hi' }] },
 *     { kind: 'list', ordered: false, items: [{ content: [{ text: 'a' }] }, { content: [{ text: 'b' }] }] },
 *   ],
 *   '\n',
 * )
 * // -> [{ text: 'Hi' }, { text: '\n' }, { text: 'a' }, { text: '\n' }, { text: 'b' }]
 * ```
 */
export function flattenRichText<C extends string>(
  blocks: readonly RichTextBlock<C>[],
  separator: string,
): RichTextRun<C>[] {
  const leaves = blocks.flatMap((block) =>
    block.kind === 'list' ? listLeaves(block) : [block.content],
  );
  return intersperse(leaves, (): RichTextRun<C>[] => [{ text: separator }]).flat();
}

/**
 * The runs of each item in a list, in document order.
 */
function listLeaves<C extends string>(list: RichTextList<C>): RichTextRun<C>[][] {
  return list.items.flatMap((item) => [item.content, ...(item.list ? listLeaves(item.list) : [])]);
}
