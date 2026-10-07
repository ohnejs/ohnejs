import type {
  RichText,
  RichTextBlock,
  RichTextElement,
  RichTextHeadingLevel,
  RichTextList,
  RichTextListItem,
  RichTextMark,
  RichTextOptions,
  RichTextRun,
} from './rich-text.ts';

import { isUndefined } from '../is/is-undefined.ts';
import { flattenRichText } from './_flatten.ts';
import { checkLink } from './check-link.ts';
import { mergeRuns } from './merge-runs.ts';
import {
  RICH_TEXT_DEFAULT_ELEMENTS,
  RICH_TEXT_DEFAULT_MARKS,
  RICH_TEXT_MAX_LIST_DEPTH,
} from './rich-text.ts';

interface Allowed {
  elements: ReadonlySet<RichTextElement>;
  marks: ReadonlySet<RichTextMark>;
  links: boolean | readonly string[];
}

const LEVELS: readonly RichTextHeadingLevel[] = [2, 3, 4, 5, 6];

/**
 * Clips a rich text value to what `options` allow, as a new tree that passes `checkRichText` under them.
 * A heading moves to the nearest allowed level, the higher heading on a tie, or becomes a paragraph.
 * A list of a disallowed type takes the other type when allowed, and otherwise one paragraph per item.
 * A disallowed quote becomes a paragraph, disallowed marks are dropped, and a disallowed link keeps its text.
 * Items deeper than lists may nest lift to the deepest level, and each leaf's runs go through `mergeRuns`.
 * Under `inline`, every leaf joins one paragraph, with `\n` between leaves, or a space without `lineBreaks`.
 *
 * @example
 * ```ts
 * conformRichText(
 *   [{ kind: 'heading', level: 5, content: [{ text: 'a', marks: ['del'], link: { url: '/a' } }] }],
 *   { elements: ['h2'], marks: ['strong'], links: false },
 * )
 * // -> [{ kind: 'heading', level: 2, content: [{ text: 'a' }] }]
 * ```
 */
export function conformRichText<C extends string>(
  value: RichText<C>,
  options: RichTextOptions = {},
): RichText<C> {
  const {
    inline = false,
    elements = RICH_TEXT_DEFAULT_ELEMENTS,
    marks = RICH_TEXT_DEFAULT_MARKS,
    links = true,
    lineBreaks = true,
  } = options;
  const allowed: Allowed = { elements: new Set(elements), marks: new Set(marks), links };
  const blocks = value.flatMap((block) => conformBlock(block, allowed));
  if (!inline || blocks.length === 0) return blocks;
  const content = mergeRuns(flattenRichText(blocks, lineBreaks ? '\n' : ' '));
  return [{ kind: 'paragraph', content }];
}

/**
 * Conforms a top-level block, as the blocks that replace it.
 */
function conformBlock<C extends string>(
  block: RichTextBlock<C>,
  allowed: Allowed,
): RichTextBlock<C>[] {
  if (block.kind === 'list') {
    const list = conformList(block, 0, allowed);
    if (list) return [list];
    return flattenItems(block).map((item) => paragraph(item.content, allowed));
  }
  const content = conformRuns(block.content, allowed);
  if (block.kind === 'heading') {
    const level = nearestLevel(block.level, allowed.elements);
    return [level ? { kind: 'heading', level, content } : { kind: 'paragraph', content }];
  }
  if (block.kind === 'quote' && allowed.elements.has('blockquote'))
    return [{ kind: 'quote', content }];
  return [{ kind: 'paragraph', content }];
}

/**
 * Conforms a list that `depth` lists enclose, or returns `undefined` when no list type is allowed.
 */
function conformList<C extends string>(
  list: RichTextList<C>,
  depth: number,
  allowed: Allowed,
): RichTextList<C> | undefined {
  const ordered = listType(list.ordered, allowed.elements);
  if (isUndefined(ordered)) return undefined;
  return { kind: 'list', ordered, items: conformItems(list.items, depth, allowed) };
}

/**
 * Conforms the items of a list that `depth` lists enclose.
 * At the deepest level, a nested list's items follow their parent as siblings.
 */
function conformItems<C extends string>(
  items: readonly RichTextListItem<C>[],
  depth: number,
  allowed: Allowed,
): RichTextListItem<C>[] {
  return items.flatMap((item) => {
    const own: RichTextListItem<C> = { content: conformRuns(item.content, allowed) };
    if (!item.list) return [own];
    if (depth + 1 >= RICH_TEXT_MAX_LIST_DEPTH) {
      return [own, ...conformItems(flattenItems(item.list), depth, allowed)];
    }
    const list = conformList(item.list, depth + 1, allowed);
    return [list ? { ...own, list } : own];
  });
}

/**
 * The items of a list and of every list nested in it, in document order and without their lists.
 */
function flattenItems<C extends string>(list: RichTextList<C>): RichTextListItem<C>[] {
  return list.items.flatMap((item) => [
    { content: item.content },
    ...(item.list ? flattenItems(item.list) : []),
  ]);
}

/**
 * Conforms the runs of a leaf: disallowed marks and links go, and the rest merge.
 */
function conformRuns<C extends string>(
  runs: readonly RichTextRun<C>[],
  allowed: Allowed,
): RichTextRun<C>[] {
  return mergeRuns(
    runs.map(({ text, marks = [], link }) => ({
      text,
      marks: marks.filter((mark) => allowed.marks.has(mark)),
      link: link && checkLink(link, allowed.links).length === 0 ? link : undefined,
    })),
  );
}

/**
 * A paragraph of conformed runs.
 */
function paragraph<C extends string>(
  runs: readonly RichTextRun<C>[],
  allowed: Allowed,
): RichTextBlock<C> {
  return { kind: 'paragraph', content: conformRuns(runs, allowed) };
}

/**
 * The allowed heading level closest to `level`, the higher heading on a tie, or `undefined` when none is.
 */
function nearestLevel(
  level: RichTextHeadingLevel,
  elements: ReadonlySet<RichTextElement>,
): RichTextHeadingLevel | undefined {
  let nearest: RichTextHeadingLevel | undefined;
  for (const candidate of LEVELS) {
    if (!elements.has(`h${candidate}`)) continue;
    if (isUndefined(nearest) || Math.abs(candidate - level) < Math.abs(nearest - level)) {
      nearest = candidate;
    }
  }
  return nearest;
}

/**
 * Whether a list of type `ordered` stays, flips to the other type, or has no allowed type at all.
 */
function listType(ordered: boolean, elements: ReadonlySet<RichTextElement>): boolean | undefined {
  if (elements.has(ordered ? 'ol' : 'ul')) return ordered;
  return elements.has(ordered ? 'ul' : 'ol') ? !ordered : undefined;
}
