import type { RichTextMark } from './rich-text.ts';

import { isArray } from '../is/is-array.ts';
import { isPlainObject } from '../is/is-plain-object.ts';
import { isString } from '../is/is-string.ts';
import { MAX_LIST_DEPTH } from './_walk.ts';
import { RICH_TEXT_MARKS } from './rich-text.ts';

/**
 * A node of a value that may be malformed, read one key at a time.
 */
export type Node = Record<string, unknown>;

/**
 * A run as a projection reads it from a value that may be malformed.
 */
export interface ReadRun {
  /**
   * The run's index in its `content`.
   */
  index: number;

  /**
   * The run's text.
   */
  text: string;

  /**
   * The marks the run names, each once, in `RICH_TEXT_MARKS` order.
   */
  marks: RichTextMark[];

  /**
   * Whatever the run holds as `link`.
   */
  link: unknown;
}

/**
 * A list as a projection reads it from a value that may be malformed.
 */
export interface ReadList {
  /**
   * Whether the list is numbered.
   */
  ordered: boolean;

  /**
   * The list's items, as they are.
   */
  items: unknown[];
}

/**
 * The runs of one block or list item, with the path of their `content`.
 */
export interface Leaf {
  /**
   * The path of the leaf's `content`, as `checkRichText` writes it.
   */
  path: string;

  /**
   * The index of the top-level block the leaf sits in.
   */
  block: number;

  /**
   * The runs of the leaf that hold string text.
   */
  runs: ReadRun[];
}

const LEAF_KINDS: ReadonlySet<unknown> = new Set(['paragraph', 'heading', 'quote']);

/**
 * Reads the runs of a `content` that may be malformed: each plain object with string text, in order.
 * Anything else is skipped, and a `content` that is not an array holds no runs.
 *
 * @example
 * ```ts
 * readRuns([{ text: 'a', marks: ['code', 'em', 'em'] }, { text: 1 }, 'b'])
 * // -> [{ index: 0, text: 'a', marks: ['em', 'code'], link: undefined }]
 * ```
 */
export function readRuns(content: unknown): ReadRun[] {
  if (!isArray(content)) return [];
  return content.flatMap((run, index) =>
    isPlainObject(run) && isString(run.text)
      ? [{ index, text: run.text, marks: readMarks(run.marks), link: run.link }]
      : [],
  );
}

/**
 * Reads a list that `depth` lists already enclose, or returns `undefined` when it cannot be read.
 * A list is unreadable past `MAX_LIST_DEPTH`, or without `kind: 'list'` and an `items` array.
 *
 * @example
 * ```ts
 * readList({ kind: 'list', ordered: true, items: [] }, 0) // -> { ordered: true, items: [] }
 * readList({ kind: 'list', ordered: true, items: [] }, 4) // -> undefined
 * readList({ kind: 'list', ordered: true }, 0)            // -> undefined
 * readList({ ordered: true, items: [] }, 0)               // -> undefined
 * ```
 */
export function readList(node: unknown, depth: number): ReadList | undefined {
  if (!isPlainObject(node) || node.kind !== 'list' || depth >= MAX_LIST_DEPTH) return undefined;
  if (!isArray(node.items)) return undefined;
  return { ordered: node.ordered === true, items: node.items };
}

/**
 * Reads the leaves of a value that may be malformed, in document order: a block's runs, then each item's.
 * Unknown kinds, nodes that are not objects and lists that `readList` refuses are skipped.
 *
 * @example
 * ```ts
 * leaves([{ kind: 'list', ordered: false, items: [{ content: [{ text: 'a' }] }] }])
 * // -> [{
 * //   path: '[0].items[0].content',
 * //   block: 0,
 * //   runs: [{ index: 0, text: 'a', marks: [], link: undefined }],
 * // }]
 * ```
 */
export function leaves(value: unknown): Leaf[] {
  if (!isArray(value)) return [];
  return value.flatMap((block, index) => {
    if (!isPlainObject(block)) return [];
    if (block.kind === 'list') return listLeaves(block, `[${index}]`, index, 0);
    return LEAF_KINDS.has(block.kind) ? [leaf(block, `[${index}]`, index)] : [];
  });
}

/**
 * The leaves of a list at `path`, which `depth` lists already enclose.
 */
function listLeaves(node: unknown, path: string, block: number, depth: number): Leaf[] {
  const list = readList(node, depth);
  if (!list) return [];
  return list.items.flatMap((item, index) => {
    if (!isPlainObject(item)) return [];
    const itemPath = `${path}.items[${index}]`;
    return [
      leaf(item, itemPath, block),
      ...listLeaves(item.list, `${itemPath}.list`, block, depth + 1),
    ];
  });
}

/**
 * The leaf of a block or item at `path`.
 */
function leaf(node: Node, path: string, block: number): Leaf {
  return { path: `${path}.content`, block, runs: readRuns(node.content) };
}

/**
 * The known marks among `marks`, each once, in `RICH_TEXT_MARKS` order.
 */
function readMarks(marks: unknown): RichTextMark[] {
  return isArray(marks) ? RICH_TEXT_MARKS.filter((mark) => marks.includes(mark)) : [];
}
