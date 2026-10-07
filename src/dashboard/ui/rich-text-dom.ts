import type { Link, RecordLink } from '../../utils/rich-text/link.ts';
import type {
  RichText,
  RichTextBlock,
  RichTextListItem,
  RichTextRun,
} from '../../utils/rich-text/rich-text.ts';
import type { Leaf, NodePoint, Pos, Selection } from './rich-text-model.ts';

import { intersperse } from '../../utils/array/intersperse.ts';
import { last } from '../../utils/array/last.ts';
import { reconcile } from '../../utils/array/reconcile.ts';
import { isSafeHref } from '../../utils/html/is-safe-href.ts';
import { deepEqual } from '../../utils/object/deep-equal.ts';
import { isRecordLink } from '../../utils/rich-text/is-record-link.ts';
import { RICH_TEXT_MARKS } from '../../utils/rich-text/rich-text.ts';
import { h } from '../render/h.ts';
import { domText, formatPath, leafPoint, parsePath, pointOffset } from './rich-text-model.ts';

/**
 * How a view renders links.
 */
export interface RichTextViewOptions<C extends string = string> {
  /**
   * The address a record link opens.
   * Without it, or when the address fails `isSafeHref`, a record link renders without `href`.
   */
  href?(link: RecordLink<C>): string | undefined;

  /**
   * Whether a record link's target is missing, which draws its link dashed.
   */
  missing?(link: RecordLink<C>): boolean;

  /**
   * The title a link to a missing record shows instead of its destination.
   */
  missingLabel?(): string;
}

/**
 * What one render marks besides the document.
 */
export interface RichTextRenderOptions {
  /**
   * A leaf whose text the browser already shows, typed natively.
   * Its children are rebuilt only when they differ from what a render would draw.
   */
  typed?: Leaf;

  /**
   * The leaves that carry an error, drawn with a destructive rule.
   */
  errors?: ReadonlySet<Leaf>;

  /**
   * The text the single empty leaf shows.
   */
  placeholder?: string;
}

/**
 * A rendered document inside a root element, and the map between its DOM and model positions.
 */
export interface RichTextView<C extends string = string> {
  /**
   * Brings the DOM in line with `doc`, keeping every element whose node did not change.
   */
  render(doc: RichText<C>, options?: RichTextRenderOptions): void;

  /**
   * Forgets every rendered element and empties the root, so the next render draws from scratch.
   */
  reset(): void;

  /**
   * Whether the DOM still has the structure the last render drew, apart from the text inside leaves.
   */
  intact(): boolean;

  /**
   * The element of the leaf at `path`.
   */
  leafElement(path: readonly number[]): HTMLElement | undefined;

  /**
   * The model position of a DOM point inside the root.
   * A point between leaves maps to the start of the next leaf, or the end of the last one.
   */
  posOf(node: Node, offset: number): Pos | undefined;

  /**
   * The document's selection as model positions, or `undefined` when it lies outside the root.
   */
  readSelection(): Selection | undefined;

  /**
   * Puts the document's selection on `selection`, leaving it alone when it is already there.
   */
  writeSelection(selection: Selection): void;

  /**
   * The model position under a viewport point, as a drop lands.
   */
  posFromPoint(x: number, y: number): Pos | undefined;

  /**
   * The link an `<a>` of the last renders stands for.
   */
  linkOf(anchor: object): Link<C> | undefined;

  /**
   * Redraws the missing state and the title of every rendered link.
   */
  decorateLinks(): void;
}

interface LeafView {
  element: HTMLElement;
  content?: readonly RichTextRun[];
  path?: string;
}

interface Keyed<V> {
  order: object[];
  views: Map<object, V>;
}

interface ListView extends Keyed<ItemView> {
  element: HTMLElement;
  tag: string;
}

interface ItemView {
  element: HTMLElement;
  tag: string;
  leaf: LeafView;
  list?: ListView;
}

interface BlockView {
  element: HTMLElement;
  tag: string;
  leaf?: LeafView;
  list?: ListView;
}

const MISSING = 'ohne-rich-text-link-missing';
const ERROR = 'ohne-rich-text-leaf-error';
const INNER_MARKS = RICH_TEXT_MARKS.toReversed();

/**
 * The checked address of a link: its `url`, or what `href` gives for a record, when it passes `isSafeHref`.
 */
export function linkHref<C extends string>(
  link: Link<C>,
  href?: (link: RecordLink<C>) => string | undefined,
): string | undefined {
  const value = isRecordLink(link) ? href?.(link) : link.url;
  return value !== undefined && isSafeHref(value) ? value : undefined;
}

/**
 * Renders rich text into `root` and maps positions between its DOM and the model.
 * Each leaf is one element with a `data-path`: `<p>`, `<h2>` to `<h6>`, `<blockquote>`, or an item's `<div>`.
 * An item renders as `<li><div data-path>runs</div><ul>…</ul></li>`, so its sublist stays out of its text.
 * Runs are text nodes inside `a`, then `strong`, `em`, `del` and `code`, and `\n` is a `<br>`.
 * An empty leaf holds one `<br>`, and a leaf ending in `\n` one more.
 * Blocks and items reconcile by identity.
 * A node that takes the index of a departed node of the same tag reuses its element.
 * A leaf's runs re-render only when its `content` changed.
 */
export function createRichTextView<C extends string>(
  root: HTMLElement,
  options: RichTextViewOptions<C> = {},
): RichTextView<C> {
  const { ownerDocument } = root;
  const links = new WeakMap<object, Link<C>>();
  const blocks: Keyed<BlockView> = { order: [], views: new Map() };
  let placed: LeafView[] = [];
  let byElement = new Map<Node, LeafView>();
  let byPath = new Map<string, HTMLElement>();
  let typed: Leaf | undefined;

  const anchor = (link: Link<C>, children: Node[]): HTMLElement => {
    const element = h(
      'a',
      { href: linkHref(link, options.href), target: '_blank', rel: 'noopener noreferrer' },
      ...children,
    );
    links.set(element, link);
    decorate(element, link);
    return element;
  };

  const decorate = (element: HTMLElement, link: Link<C>): void => {
    const missing = isRecordLink(link) && (options.missing?.(link) ?? false);
    const title = missing
      ? options.missingLabel?.()
      : (linkHref(link, options.href) ?? (isRecordLink(link) ? undefined : link.url));
    element.classList.toggle(MISSING, missing);
    if (!element.classList.length) element.removeAttribute('class');
    if (title) element.setAttribute('title', title);
    else element.removeAttribute('title');
  };

  const runNodes = (runs: readonly RichTextRun<C>[]): Node[] => {
    if (runs.length === 0) return [h('br')];
    const nodes: Node[] = [];
    for (let start = 0; start < runs.length; ) {
      const { link } = runs[start]!;
      let end = start + 1;
      while (link && end < runs.length && deepEqual(runs[end]!.link, link)) end++;
      const inner = runs.slice(start, end).flatMap(markedNodes);
      nodes.push(...(link ? [anchor(link, inner)] : inner));
      start = end;
    }
    if (last(runs)!.text.endsWith('\n')) nodes.push(h('br'));
    return nodes;
  };

  const markedNodes = (run: RichTextRun<C>): Node[] => {
    let nodes = intersperse(run.text.split('\n'), () => '\n')
      .filter(Boolean)
      .map((part) => (part === '\n' ? h('br') : ownerDocument.createTextNode(part)));
    for (const mark of INNER_MARKS)
      if (run.marks?.includes(mark)) nodes = [h(mark, null, ...nodes)];
    return nodes;
  };

  const fill = (view: LeafView, leaf: Leaf<C>): void => {
    if (view.content === leaf.content) return;
    view.content = leaf.content;
    if (leaf !== typed) view.element.replaceChildren(...runNodes(leaf.content));
  };

  const createLeaf = (tag: string, leaf: Leaf<C>): LeafView => {
    const view = { element: h(tag) };
    fill(view, leaf);
    return view;
  };

  const createList = (ordered: boolean): ListView => {
    const tag = ordered ? 'OL' : 'UL';
    return { element: h(tag.toLowerCase()), tag, order: [], views: new Map() };
  };

  const syncItems = (list: ListView, items: readonly RichTextListItem<C>[]): void =>
    sync(list.element, list, items, () => 'LI', createItem, updateItem);

  const createItem = (item: RichTextListItem<C>): ItemView => {
    const leaf = createLeaf('div', item);
    const view: ItemView = { element: h('li', null, leaf.element), tag: 'LI', leaf };
    setSublist(view, item);
    return view;
  };

  const updateItem = (view: ItemView, item: RichTextListItem<C>): void => {
    fill(view.leaf, item);
    setSublist(view, item);
  };

  const setSublist = (view: ItemView, { list }: RichTextListItem<C>): void => {
    if (view.list?.tag !== (list && (list.ordered ? 'OL' : 'UL'))) {
      view.list?.element.remove();
      view.list = list && createList(list.ordered);
      if (view.list) view.element.append(view.list.element);
    }
    if (view.list && list) syncItems(view.list, list.items);
  };

  const createBlock = (block: RichTextBlock<C>): BlockView => {
    const tag = blockTag(block);
    if (block.kind !== 'list') {
      const leaf = createLeaf(tag.toLowerCase(), block);
      return { element: leaf.element, tag, leaf };
    }
    const list = createList(block.ordered);
    syncItems(list, block.items);
    return { element: list.element, tag, list };
  };

  const updateBlock = (view: BlockView, block: RichTextBlock<C>): void => {
    if (block.kind === 'list') syncItems(view.list!, block.items);
    else fill(view.leaf!, block);
  };

  const place = (
    view: LeafView,
    leaf: Leaf<C>,
    path: readonly number[],
    errors?: ReadonlySet<Leaf>,
  ) => {
    const value = formatPath(path);
    if (view.path !== value) view.element.setAttribute('data-path', (view.path = value));
    view.element.classList.toggle(ERROR, errors?.has(leaf) ?? false);
    if (!view.element.classList.length) view.element.removeAttribute('class');
    if (leaf === typed) repair(view, leaf);
    placed.push(view);
    byPath.set(value, view.element);
  };

  const placeItems = (
    list: ListView,
    items: readonly RichTextListItem<C>[],
    path: readonly number[],
    errors?: ReadonlySet<Leaf>,
  ): void =>
    items.forEach((item, index) => {
      const view = list.views.get(item)!;
      place(view.leaf, item, [...path, index], errors);
      if (view.list && item.list) placeItems(view.list, item.list.items, [...path, index], errors);
    });

  const repair = (view: LeafView, leaf: Leaf<C>): void => {
    const probe = view.element.cloneNode(false) as HTMLElement;
    probe.append(...runNodes(leaf.content));
    if (!probe.isEqualNode(view.element)) view.element.replaceChildren(...probe.childNodes);
  };

  const leafAround = (node: Node): HTMLElement | undefined => {
    for (
      let current: Node | null = node;
      current && current !== root;
      current = current.parentNode
    ) {
      const view = byElement.get(current);
      if (view) return view.element;
    }
    return undefined;
  };

  const pointAt = (pos: Pos): NodePoint<Node> | undefined => {
    const element = byPath.get(formatPath(pos.path));
    return element && leafPoint<Node>(element, pos.offset);
  };

  const posOf = (node: Node, offset: number): Pos | undefined => {
    if (!root.contains(node)) return undefined;
    const leaf = leafAround(node);
    if (leaf) return { path: pathOf(leaf), offset: pointOffset<Node>(leaf, node, offset) };
    const range = ownerDocument.createRange();
    range.setStart(node, offset);
    const next = placed.find((view) => range.comparePoint(view.element, 0) >= 0);
    if (next) return { path: pathOf(next.element), offset: 0 };
    const end = last(placed)?.element;
    return end && { path: pathOf(end), offset: domText<Node>(end).length };
  };

  return {
    render(doc, { typed: leaf, errors, placeholder } = {}) {
      typed = leaf;
      sync(root, blocks, doc, blockTag, createBlock, updateBlock);
      placed = [];
      byPath = new Map();
      doc.forEach((block, index) => {
        const view = blocks.views.get(block)!;
        if (block.kind === 'list') placeItems(view.list!, block.items, [index], errors);
        else place(view.leaf!, block, [index], errors);
      });
      byElement = new Map(placed.map((view) => [view.element, view]));
      const empty = placed.length === 1 && placed[0]!.content?.length === 0;
      for (const { element } of placed) {
        if (empty && placeholder) element.setAttribute('data-placeholder', placeholder);
        else element.removeAttribute('data-placeholder');
      }
      typed = undefined;
    },

    reset() {
      blocks.order = [];
      blocks.views.clear();
      placed = [];
      byElement = new Map();
      byPath = new Map();
      root.replaceChildren();
    },

    intact() {
      const holds = (parent: Node, children: readonly Node[]) =>
        parent.childNodes.length === children.length &&
        children.every((child, index) => parent.childNodes[index] === child);
      const listHolds = (list: ListView): boolean =>
        holds(
          list.element,
          list.order.map((item) => list.views.get(item)!.element),
        ) &&
        list.order.every((item) => {
          const view = list.views.get(item)!;
          const children = view.list ? [view.leaf.element, view.list.element] : [view.leaf.element];
          return holds(view.element, children) && (!view.list || listHolds(view.list));
        });
      return (
        holds(
          root,
          blocks.order.map((block) => blocks.views.get(block)!.element),
        ) &&
        blocks.order.every((block) => {
          const view = blocks.views.get(block)!;
          return view.list ? listHolds(view.list) : true;
        }) &&
        [...byPath].every(([path, element]) => element.getAttribute('data-path') === path)
      );
    },

    leafElement: (path) => byPath.get(formatPath(path)),

    posOf,

    readSelection() {
      const selection = ownerDocument.getSelection();
      if (!selection?.anchorNode || !selection.focusNode) return undefined;
      const anchor = posOf(selection.anchorNode, selection.anchorOffset);
      const head = posOf(selection.focusNode, selection.focusOffset);
      return anchor && head && { anchor, head };
    },

    writeSelection(selection) {
      const anchor = pointAt(selection.anchor);
      const head = pointAt(selection.head);
      const current = ownerDocument.getSelection();
      if (!anchor || !head || !current) return;
      if (
        current.anchorNode === anchor.node &&
        current.anchorOffset === anchor.offset &&
        current.focusNode === head.node &&
        current.focusOffset === head.offset
      ) {
        return;
      }
      current.setBaseAndExtent(anchor.node, anchor.offset, head.node, head.offset);
    },

    posFromPoint(x, y) {
      const caret = ownerDocument.caretPositionFromPoint?.(x, y);
      if (caret) return posOf(caret.offsetNode, caret.offset);
      const range = ownerDocument.caretRangeFromPoint?.(x, y);
      return range ? posOf(range.startContainer, range.startOffset) : undefined;
    },

    linkOf: (anchor) => links.get(anchor),

    decorateLinks() {
      for (const element of root.querySelectorAll('a')) {
        const link = links.get(element);
        if (link) decorate(element, link);
      }
    },
  };
}

/**
 * Brings the children of `parent` in line with `nodes`, keyed by node identity.
 * A new node at the index of an old one that left, and of the same tag, takes over the old one's element.
 */
function sync<N extends object, V extends { element: HTMLElement; tag: string }>(
  parent: HTMLElement,
  keyed: Keyed<V>,
  nodes: readonly N[],
  tagOf: (node: N) => string,
  create: (node: N) => V,
  update: (view: V, node: N) => void,
): void {
  const next = new Set<object>(nodes);
  nodes.forEach((node, index) => {
    const old = keyed.order[index];
    const view = old && keyed.views.get(old);
    if (!old || !view || keyed.views.has(node) || next.has(old) || view.tag !== tagOf(node)) return;
    keyed.views.delete(old);
    keyed.views.set(node, view);
    keyed.order[index] = node;
    update(view, node);
  });
  for (const node of nodes) if (!keyed.views.has(node)) keyed.views.set(node, create(node));
  for (const patch of reconcile<object>(keyed.order, nodes)) {
    const view = keyed.views.get(patch.key)!;
    if (patch.op === 'remove') {
      view.element.remove();
      keyed.views.delete(patch.key);
    } else {
      parent.insertBefore(view.element, patch.before && keyed.views.get(patch.before)!.element);
    }
  }
  keyed.order = [...nodes];
}

/**
 * The tag a block renders as, uppercase as the DOM reports it.
 */
function blockTag(block: RichTextBlock): string {
  if (block.kind === 'list') return block.ordered ? 'OL' : 'UL';
  if (block.kind === 'heading') return `H${block.level}`;
  return block.kind === 'quote' ? 'BLOCKQUOTE' : 'P';
}

/**
 * The path a rendered leaf element carries.
 */
function pathOf(element: Element): number[] {
  return parsePath(element.getAttribute('data-path')) ?? [];
}
