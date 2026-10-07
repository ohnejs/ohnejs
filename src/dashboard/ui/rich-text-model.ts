import type { NodeLike } from '../../utils/html/node-like.ts';
import type { Link } from '../../utils/rich-text/link.ts';
import type {
  RichText,
  RichTextHeading,
  RichTextListItem,
  RichTextMark,
  RichTextParagraph,
  RichTextQuote,
  RichTextRun,
} from '../../utils/rich-text/rich-text.ts';

import { last } from '../../utils/array/last.ts';
import { clamp } from '../../utils/number/clamp.ts';
import { deepEqual } from '../../utils/object/deep-equal.ts';

/**
 * A caret position: the path of a leaf and a UTF-16 offset into the leaf's run text.
 * A `\n` counts 1, as it does in `String#length`.
 */
export interface Pos {
  /**
   * The leaf's path.
   * `path[0]` is the block index, and each further index picks an item in the list below the previous one.
   */
  path: readonly number[];

  /**
   * The offset into the leaf's run text, in UTF-16 code units.
   */
  offset: number;
}

/**
 * A selection between two positions, which may run backwards.
 */
export interface Selection {
  /**
   * Where the selection started.
   */
  anchor: Pos;

  /**
   * Where the selection ends, and the caret sits.
   */
  head: Pos;
}

/**
 * A node that holds runs: a paragraph, a heading, a quote or a list item.
 */
export type Leaf<C extends string = string> =
  | RichTextParagraph<C>
  | RichTextHeading<C>
  | RichTextQuote<C>
  | RichTextListItem<C>;

/**
 * A leaf and its path.
 */
export interface LeafEntry<C extends string = string> {
  /**
   * The leaf's path, as `Pos.path` holds it.
   */
  path: number[];

  /**
   * The leaf itself.
   */
  leaf: Leaf<C>;
}

/**
 * The stretch of a leaf that one link covers, across neighbouring runs with an equal link.
 */
export interface LinkRange<C extends string = string> {
  /**
   * The offset where the link starts.
   */
  from: number;

  /**
   * The offset where the link ends.
   */
  to: number;

  /**
   * The link.
   */
  link: Link<C>;
}

/**
 * A point in a node tree, as a DOM `Range` boundary holds it.
 * In a text node, `offset` counts characters, and in an element, children.
 */
export interface NodePoint<N> {
  /**
   * The node the point sits in.
   */
  node: N;

  /**
   * The offset in that node.
   */
  offset: number;
}

/**
 * One replacement that turns a text into another.
 */
export interface TextDiff {
  /**
   * Where the replaced text starts in the old text.
   */
  from: number;

  /**
   * Where the replaced text ends in the old text.
   */
  to: number;

  /**
   * The text that replaces it.
   */
  text: string;
}

/**
 * A node of a tree whose children are of its own kind, such as a DOM `Node` or a plain `NodeLike`.
 */
type Tree<N> = NodeLike & { childNodes: Iterable<N> };

interface Atom<N> {
  node: N;
  parent: N;
  index: number;
  size: number;
}

const ELEMENT = 1;
const TEXT = 3;
const PATH = /^\d+(\.\d+)*$/;

/**
 * Lists every leaf of a document with its path, in document order.
 * A list item comes before the items of its sublist.
 */
export function leaves<C extends string>(doc: RichText<C>): LeafEntry<C>[] {
  return doc.flatMap((block, index) =>
    block.kind === 'list' ? itemEntries(block.items, [index]) : [{ path: [index], leaf: block }],
  );
}

/**
 * The leaf at `path`, or `undefined` when no leaf sits there.
 */
export function leafAt<C extends string>(
  doc: RichText<C>,
  path: readonly number[],
): Leaf<C> | undefined {
  const [index = -1, ...rest] = path;
  const block = doc[index];
  if (block?.kind !== 'list') return rest.length === 0 ? block : undefined;
  let leaf: RichTextListItem<C> | undefined;
  let items: RichTextListItem<C>[] | undefined = block.items;
  for (const item of rest) {
    leaf = items?.[item];
    items = leaf?.list?.items;
  }
  return leaf;
}

/**
 * The run text of a leaf.
 */
export function leafText(leaf: Leaf): string {
  return leaf.content.map((run) => run.text).join('');
}

/**
 * Whether two paths point at the same leaf.
 */
export function samePath(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((index, at) => index === b[at]);
}

/**
 * Orders two positions in document order, as a negative number, zero or a positive number.
 */
export function comparePos(a: Pos, b: Pos): number {
  return comparePath(a.path, b.path) || a.offset - b.offset;
}

/**
 * Whether a selection is a caret.
 */
export function isCollapsed(selection: Selection): boolean {
  return comparePos(selection.anchor, selection.head) === 0;
}

/**
 * The ends of a selection in document order.
 */
export function selectionRange(selection: Selection): { from: Pos; to: Pos } {
  const { anchor, head } = selection;
  return comparePos(anchor, head) <= 0 ? { from: anchor, to: head } : { from: head, to: anchor };
}

/**
 * A collapsed selection at `pos`.
 */
export function caret(pos: Pos): Selection {
  return { anchor: pos, head: pos };
}

/**
 * The marks that text typed at `pos` takes: those of the character before it, or after it at a leaf's start.
 */
export function marksAt(doc: RichText, pos: Pos): readonly RichTextMark[] {
  const runs = leafAt(doc, pos.path)?.content ?? [];
  return (runAt(runs, Math.max(pos.offset - 1, 0)) ?? last(runs))?.marks ?? [];
}

/**
 * The link around `pos`, taken from the character before it, else from the character after it.
 * The range spans every neighbouring run with an equal link.
 */
export function linkRangeAt<C extends string>(
  doc: RichText<C>,
  pos: Pos,
): LinkRange<C> | undefined {
  let end = 0;
  const spans = (leafAt(doc, pos.path)?.content ?? []).map((run) => ({
    run,
    from: end,
    to: (end += run.text.length),
  }));
  const linked = (index: number) =>
    spans.findIndex((span) => span.from <= index && index < span.to && span.run.link);
  const before = pos.offset > 0 ? linked(pos.offset - 1) : -1;
  const hit = before >= 0 ? before : linked(pos.offset);
  if (hit < 0) return undefined;
  const link = spans[hit]!.run.link!;
  const same = (index: number) => deepEqual(spans[index]?.run.link, link);
  let first = hit;
  let final = hit;
  while (same(first - 1)) first--;
  while (same(final + 1)) final++;
  return { from: spans[first]!.from, to: spans[final]!.to, link };
}

/**
 * Moves a position onto the nearest place a caret can sit in `doc`.
 * An offset clamps to its leaf, and a path with no leaf falls back to the end of the leaf before it.
 */
export function clampPos(doc: RichText, pos: Pos): Pos {
  const entries = leaves(doc);
  const exact = entries.find((entry) => samePath(entry.path, pos.path));
  if (exact) return { path: exact.path, offset: clamp(pos.offset, 0, leafText(exact.leaf).length) };
  const before = entries.findLast((entry) => comparePath(entry.path, pos.path) < 0);
  if (before) return { path: before.path, offset: leafText(before.leaf).length };
  return { path: entries[0]?.path ?? [0], offset: 0 };
}

/**
 * Writes a path as the leaf element's `data-path` attribute.
 */
export function formatPath(path: readonly number[]): string {
  return path.join('.');
}

/**
 * Reads a leaf element's `data-path` attribute, or returns `undefined` when it is not a path.
 */
export function parsePath(value: string | null): number[] | undefined {
  return value !== null && PATH.test(value) ? value.split('.').map(Number) : undefined;
}

/**
 * The run text that a rendered leaf element holds.
 * A text node counts its text, and a `<br>` counts as `\n` unless it is the last node in the leaf.
 * Any other element only passes its children through.
 */
export function domText<N extends Tree<N>>(leaf: N): string {
  return atoms(leaf)
    .map((atom) => (atom.node.nodeType === TEXT ? atom.node.nodeValue : '\n'.repeat(atom.size)))
    .join('');
}

/**
 * The model offset of a point inside a rendered leaf element, which is the inverse of `leafPoint`.
 * A point outside the leaf counts as its end.
 */
export function pointOffset<N extends Tree<N>>(leaf: N, node: N, offset: number): number {
  const sizes = new Map(atoms(leaf).map((atom) => [atom.node, atom.size]));
  let count = 0;
  const walk = (parent: N): boolean => {
    let index = 0;
    for (const child of parent.childNodes) {
      if (parent === node && index === offset) return true;
      if (child === node && child.nodeType === TEXT) {
        count += Math.min(offset, sizes.get(child) ?? 0);
        return true;
      }
      if (child === node) return walk(child);
      count += sizes.get(child) ?? 0;
      if (walk(child)) return true;
      index++;
    }
    return parent === node;
  };
  walk(leaf);
  return count;
}

/**
 * The point inside a rendered leaf element where a model offset sits.
 * It prefers the end of a text node, and sits before a `<br>` that starts a line.
 */
export function leafPoint<N extends Tree<N>>(leaf: N, offset: number): NodePoint<N> {
  let start = 0;
  for (const atom of atoms(leaf)) {
    if (atom.node.nodeType === TEXT && offset <= start + atom.size) {
      return { node: atom.node, offset: Math.max(offset - start, 0) };
    }
    if (atom.node.nodeType !== TEXT && offset <= start) {
      return { node: atom.parent, offset: atom.index };
    }
    start += atom.size;
  }
  return { node: leaf, offset: [...leaf.childNodes].length };
}

/**
 * The one replacement that turns `before` into `after`, keeping the longest common prefix and suffix.
 * The change reaches at least to `caret` in `after`.
 * A letter typed beside the same letter then lands where it was typed.
 * A surrogate pair is never split.
 */
export function diffText(before: string, after: string, caret = 0): TextDiff {
  const shortest = Math.min(before.length, after.length);
  const maxSuffix = Math.min(shortest, after.length - caret);
  let suffix = 0;
  while (suffix < maxSuffix && before.at(-1 - suffix) === after.at(-1 - suffix)) suffix++;
  let prefix = 0;
  while (prefix < shortest - suffix && before[prefix] === after[prefix]) prefix++;
  if (prefix > 0 && isSurrogate(before.charCodeAt(prefix - 1), 0xd800)) prefix--;
  if (suffix > 0 && isSurrogate(before.charCodeAt(before.length - suffix), 0xdc00)) suffix--;
  return {
    from: prefix,
    to: before.length - suffix,
    text: after.slice(prefix, after.length - suffix),
  };
}

/**
 * The entries of a list's items and of every sublist, in document order.
 */
function itemEntries<C extends string>(
  items: readonly RichTextListItem<C>[],
  path: readonly number[],
): LeafEntry<C>[] {
  return items.flatMap((item, index) => {
    const itemPath = [...path, index];
    return [
      { path: itemPath, leaf: item },
      ...(item.list ? itemEntries(item.list.items, itemPath) : []),
    ];
  });
}

/**
 * Orders two paths in document order, where a leaf comes before the leaves nested under it.
 */
function comparePath(a: readonly number[], b: readonly number[]): number {
  const shared = Math.min(a.length, b.length);
  for (let index = 0; index < shared; index++) {
    if (a[index] !== b[index]) return a[index]! - b[index]!;
  }
  return a.length - b.length;
}

/**
 * The run holding the character at `index`, or `undefined` past the end.
 */
function runAt<C extends string>(
  runs: readonly RichTextRun<C>[],
  index: number,
): RichTextRun<C> | undefined {
  let end = 0;
  return runs.find((run) => (end += run.text.length) > index);
}

/**
 * The text nodes and `<br>` elements of a leaf element, in order, each with the length it counts.
 * Empty text nodes count nothing and are left out, so the last `<br>` is found past them.
 */
function atoms<N extends Tree<N>>(leaf: N): Atom<N>[] {
  const found: Atom<N>[] = [];
  const visit = (parent: N) => {
    let index = 0;
    for (const node of parent.childNodes) {
      if (node.nodeType === TEXT && node.nodeValue) {
        found.push({ node, parent, index, size: node.nodeValue.length });
      } else if (node.nodeName === 'BR') {
        found.push({ node, parent, index, size: 1 });
      } else if (node.nodeType === ELEMENT) {
        visit(node);
      }
      index++;
    }
  };
  visit(leaf);
  const end = last(found);
  if (end?.node.nodeName === 'BR') end.size = 0;
  return found;
}

/**
 * Whether a UTF-16 code unit is a surrogate of the half that `base` starts.
 */
function isSurrogate(code: number, base: 0xd800 | 0xdc00): boolean {
  return (code & 0xfc00) === base;
}
