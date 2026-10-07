import type { NodeLike } from '../html/node-like.ts';
import type { Link } from './link.ts';
import type {
  RichText,
  RichTextBlock,
  RichTextHeadingLevel,
  RichTextList,
  RichTextListItem,
  RichTextMark,
  RichTextParagraph,
  RichTextRun,
} from './rich-text.ts';

import { intersperse } from '../array/intersperse.ts';
import { isSafeHref } from '../html/is-safe-href.ts';
import { isUndefined } from '../is/is-undefined.ts';
import { flattenRichText } from './_flatten.ts';
import { mergeRuns } from './merge-runs.ts';

/**
 * What `htmlToRichText` takes besides the root.
 */
export interface HTMLToRichTextOptions<C extends string = string> {
  /**
   * Maps an anchor to the link it stands for, ahead of the URL rules.
   * Returning `undefined` leaves the anchor to those rules.
   */
  link?: (anchor: NodeLike) => Link<C> | undefined;

  /**
   * Keeps all whitespace as written, as inside a `pre`, for HTML shown with `white-space: pre-wrap`.
   * Unlike a `pre` element, it adds no `code` mark.
   *
   * @default
   * false
   */
  pre?: boolean;
}

type Resolve<C extends string> = HTMLToRichTextOptions<C>['link'];

interface Inline<C extends string> {
  marks: readonly RichTextMark[];
  link?: Link<C>;
  pre: boolean;
}

interface Raw<C extends string> {
  text: string;
  inline: Inline<C>;
}

interface Sink<C extends string> {
  blocks: RichTextBlock<C>[];
  loose: Raw<C>[];
  leaf: boolean;
  word?: WordList<C>;
}

interface WordList<C extends string> {
  group: string;
  list: RichTextList<C>;
}

interface WordItem<C extends string> {
  group: string;
  level: number;
  ordered: boolean;
  content: RichTextRun<C>[];
}

const ELEMENT = 1;
const TEXT = 3;
const ZERO_WIDTH = /[​﻿]/g;
const SPACES = /[\t\n\f\r ]+/g;
const MONOSPACE = /mono|courier|consolas|menlo|code/;
const GOOGLE_HOST = /^(www\.)?google\.com$/;
const WORD_LIST = /mso-list\s*:\s*l(\d+)\s+level(\d+)/i;
const WORD_MARKER = /mso-list\s*:\s*ignore/i;
const WORD_NUMBER = /^(\d+|[a-z]|[ivxlcdm]+)[.)]/i;
const WORD_TITLE = 'msotitle';
const WORD_QUOTES = new Set(['msoquote', 'msointensequote']);

const HEADING_LEVELS = new Map<string, RichTextHeadingLevel>([
  ['h1', 2],
  ['h2', 2],
  ['h3', 3],
  ['h4', 4],
  ['h5', 5],
  ['h6', 6],
]);
const MARK_OF = new Map<string, RichTextMark>([
  ['b', 'strong'],
  ['strong', 'strong'],
  ['i', 'em'],
  ['em', 'em'],
  ['s', 'del'],
  ['del', 'del'],
  ['strike', 'del'],
  ['code', 'code'],
  ['kbd', 'code'],
  ['samp', 'code'],
  ['tt', 'code'],
]);
const DROPPED = new Set([
  'o:p',
  'head',
  'title',
  'meta',
  'link',
  'base',
  'style',
  'script',
  'template',
  'noscript',
  'svg',
  'math',
  'img',
  'picture',
  'source',
  'track',
  'video',
  'audio',
  'canvas',
  'iframe',
  'embed',
  'object',
  'map',
  'area',
  'colgroup',
  'col',
  'input',
  'textarea',
  'select',
  'option',
  'optgroup',
  'button',
  'datalist',
  'progress',
  'meter',
]);
const BOUNDARY = new Set([
  'html',
  'body',
  'div',
  'section',
  'article',
  'main',
  'header',
  'footer',
  'aside',
  'nav',
  'figure',
  'figcaption',
  'center',
  'address',
  'hr',
  'dl',
  'dt',
  'dd',
  'details',
  'summary',
  'form',
  'fieldset',
  'legend',
  'thead',
  'tbody',
  'tfoot',
]);
const TABLE_SECTIONS = new Set(['thead', 'tbody', 'tfoot']);
const CELLS = new Set(['td', 'th']);
const LISTS = new Set(['ul', 'ol']);

/**
 * Reads the HTML under `root` as a rich text value, by element name and inline style.
 * `p`, a `div` of inline content, `pre` and loose text give paragraphs, and `h1` to `h6` give headings.
 * `blockquote` gives one quote per inner block, `ul` and `ol` give lists, and `li > p` unwraps.
 * A list sitting directly inside a list joins the item before it.
 * A `table` gives one paragraph per row, with its cells joined by ` | `.
 * `b`, `strong` and a `font-weight` of 600 or more give `strong`, and a weight of 500 or less cancels it.
 * `i`, `em` and an italic `font-style` give `em`, and `s`, `del`, `strike` and `line-through` give `del`.
 * `code`, `kbd`, `samp`, `tt`, `pre` and a monospace first font family give `code`.
 * An `a` becomes the link `options.link` returns, else a URL link when its `href` passes `isSafeHref`.
 * A `google.com/url?q=` wrapper unwraps, `target="_blank"` sets `newTab`, and a `#fragment` keeps its text.
 * A Word paragraph styled `mso-list:lN levelM` gives an item at level M of the list grouped by N.
 * That list is numbered when its `mso-list:Ignore` marker reads like `1.`, `a)` or `iv.`.
 * `MsoTitle` gives a heading, `MsoQuote` and `MsoIntenseQuote` give quotes, and `o:p` is dropped.
 * Whitespace collapses outside `pre` and `options.pre`.
 * NBSP becomes a space, and U+200B and U+FEFF are removed.
 * A `br` inside a leaf is `\n`, and one between blocks is ignored.
 * Media, `svg`, `script`, `style`, `template`, `head` and form controls are dropped with their content.
 * Lists may nest deeper than a value allows, so `conformRichText` clips the result to a field's options.
 *
 * @example
 * ```ts
 * htmlToRichText(new DOMParser().parseFromString('<h1>Hi</h1><p>a <b>b</b></p>', 'text/html').body)
 * // -> [
 * //   { kind: 'heading', level: 2, content: [{ text: 'Hi' }] },
 * //   { kind: 'paragraph', content: [{ text: 'a ' }, { text: 'b', marks: ['strong'] }] },
 * // ]
 * ```
 */
export function htmlToRichText<C extends string = string>(
  root: NodeLike,
  { link, pre = false }: HTMLToRichTextOptions<C> = {},
): RichText<C> {
  return blocksOf(root.childNodes, { marks: [], pre }, link);
}

/**
 * Reads sibling nodes as blocks, where loose inline content between blocks forms a paragraph.
 * Under `leaf`, a `br` ahead of any content still counts, as the nodes are one leaf's own.
 */
function blocksOf<C extends string>(
  nodes: Iterable<NodeLike>,
  inline: Inline<C>,
  resolve: Resolve<C>,
  leaf = false,
): RichTextBlock<C>[] {
  const sink: Sink<C> = { blocks: [], loose: [], leaf };
  walkNodes(nodes, inline, resolve, sink);
  flush(sink);
  return sink.blocks;
}

/**
 * Walks sibling nodes into `sink`.
 * An inline element passes its children through, so blocks inside it still read as blocks.
 */
function walkNodes<C extends string>(
  nodes: Iterable<NodeLike>,
  inline: Inline<C>,
  resolve: Resolve<C>,
  sink: Sink<C>,
): void {
  for (const node of nodes) {
    const name = elementName(node);
    if (isUndefined(name)) {
      sink.loose.push(...rawText(node, inline));
      continue;
    }
    if (DROPPED.has(name) || WORD_MARKER.test(styleOf(node))) continue;
    if (name === 'br') {
      if (sink.leaf || sink.loose.some(holdsText)) sink.loose.push({ text: '\n', inline });
      continue;
    }
    const inner = inlineOf(name, node, inline, resolve);
    const item = wordItemOf(name, node, inner, resolve);
    if (item) {
      flush(sink);
      addWordItem(sink, item);
      continue;
    }
    const block = blockOf(name, node, inner, resolve);
    if (block) {
      flush(sink);
      sink.blocks.push(...block);
      continue;
    }
    const boundary = BOUNDARY.has(name);
    if (boundary) flush(sink);
    walkNodes(node.childNodes, inner, resolve, sink);
    if (boundary) flush(sink);
  }
}

/**
 * Closes the paragraph of loose runs in `sink`, unless nothing but whitespace was loose.
 */
function flush<C extends string>(sink: Sink<C>): void {
  const content = finishRuns(sink.loose);
  if (content.length > 0) sink.blocks.push({ kind: 'paragraph', content });
  sink.loose = [];
}

/**
 * Reads a block element, or returns `undefined` for an element that is not one.
 */
function blockOf<C extends string>(
  name: string,
  node: NodeLike,
  inline: Inline<C>,
  resolve: Resolve<C>,
): RichTextBlock<C>[] | undefined {
  const classes = name === 'p' ? classesOf(node) : [];
  const level = HEADING_LEVELS.get(name) ?? (classes.includes(WORD_TITLE) ? 2 : undefined);
  if (level) return [{ kind: 'heading', level, content: leafRuns(node, inline, resolve) }];
  if (classes.some((token) => WORD_QUOTES.has(token))) {
    return [{ kind: 'quote', content: leafRuns(node, inline, resolve) }];
  }
  if (name === 'p' || name === 'pre' || name === 'li' || CELLS.has(name)) {
    return [{ kind: 'paragraph', content: leafRuns(node, inline, resolve) }];
  }
  if (name === 'blockquote') return blocksOf(node.childNodes, inline, resolve).map(quoteOf);
  if (LISTS.has(name)) return [listOf(node, name === 'ol', inline, resolve)];
  if (name === 'table') return tableOf(node, inline, resolve);
  if (name === 'tr') return [rowOf(node, inline, resolve)];
  return undefined;
}

/**
 * Reads the runs of a leaf element, joining any blocks inside it with `\n`.
 */
function leafRuns<C extends string>(
  node: NodeLike,
  inline: Inline<C>,
  resolve: Resolve<C>,
): RichTextRun<C>[] {
  return mergeRuns(flattenRichText(blocksOf(node.childNodes, inline, resolve, true), '\n'));
}

/**
 * Turns a block read inside a `blockquote` into a quote.
 */
function quoteOf<C extends string>(block: RichTextBlock<C>): RichTextBlock<C> {
  const content = block.kind === 'list' ? flattenRichText([block], '\n') : block.content;
  return { kind: 'quote', content: mergeRuns(content) };
}

/**
 * Reads a `ul` or `ol`, where a list directly inside it nests under the item before it.
 */
function listOf<C extends string>(
  node: NodeLike,
  ordered: boolean,
  inline: Inline<C>,
  resolve: Resolve<C>,
): RichTextList<C> {
  const items: RichTextListItem<C>[] = [];
  for (const child of node.childNodes) {
    const name = elementName(child);
    if (isUndefined(name) || DROPPED.has(name)) continue;
    const inner = inlineOf(name, child, inline, resolve);
    if (!LISTS.has(name)) {
      items.push(itemOf(child, inner, resolve));
      continue;
    }
    const list = listOf(child, name === 'ol', inner, resolve);
    const last = items.at(-1);
    if (!last) items.push({ content: [], list });
    else last.list = last.list ? joinLists(last.list, list) : list;
  }
  return { kind: 'list', ordered, items };
}

/**
 * Reads an `li`: its blocks join into its runs, and the lists among them nest under it.
 */
function itemOf<C extends string>(
  node: NodeLike,
  inline: Inline<C>,
  resolve: Resolve<C>,
): RichTextListItem<C> {
  const blocks = blocksOf(node.childNodes, inline, resolve, true);
  const lists = blocks.filter((block) => block.kind === 'list');
  const leaves = blocks.filter((block) => block.kind !== 'list');
  const content = mergeRuns(flattenRichText(leaves, '\n'));
  return lists.length > 0 ? { content, list: lists.reduce(joinLists) } : { content };
}

/**
 * Appends the items of `next` to `list`.
 */
function joinLists<C extends string>(
  list: RichTextList<C>,
  next: RichTextList<C>,
): RichTextList<C> {
  return { ...list, items: [...list.items, ...next.items] };
}

/**
 * Reads a Word list paragraph as an item, or returns `undefined` for any other element.
 * Its marker decides whether the item counts, and never reaches the item's runs.
 */
function wordItemOf<C extends string>(
  name: string,
  node: NodeLike,
  inline: Inline<C>,
  resolve: Resolve<C>,
): WordItem<C> | undefined {
  const match = name === 'p' ? WORD_LIST.exec(styleOf(node)) : null;
  if (!match) return undefined;
  return {
    group: match[1],
    level: Number(match[2]),
    ordered: WORD_NUMBER.test(markerText(node).trim()),
    content: leafRuns(node, inline, resolve),
  };
}

/**
 * The text of the `mso-list:Ignore` marker under `node`, `''` without one.
 */
function markerText(node: NodeLike): string {
  for (const child of node.childNodes) {
    if (isUndefined(elementName(child))) continue;
    const text = WORD_MARKER.test(styleOf(child)) ? textOf(child) : markerText(child);
    if (text !== '') return text;
  }
  return '';
}

/**
 * The text under `node`, as written.
 */
function textOf(node: NodeLike): string {
  let text = '';
  for (const child of node.childNodes) {
    text += child.nodeType === TEXT ? (child.nodeValue ?? '') : textOf(child);
  }
  return text;
}

/**
 * Adds a Word item to the list its group is building, when that list is still the last block.
 * Otherwise a new list starts, numbered as the item is.
 */
function addWordItem<C extends string>(sink: Sink<C>, item: WordItem<C>): void {
  const { word } = sink;
  if (word && word.group === item.group && word.list === sink.blocks.at(-1)) {
    nestWordItem(word.list, item, item.level);
    return;
  }
  const list: RichTextList<C> = { kind: 'list', ordered: item.ordered, items: [] };
  sink.word = { group: item.group, list };
  sink.blocks.push(list);
  nestWordItem(list, item, item.level);
}

/**
 * Nests an item `level` deep in `list`, under the last item of each level above it.
 * A level without an item there yet gets an empty one.
 */
function nestWordItem<C extends string>(
  list: RichTextList<C>,
  item: WordItem<C>,
  level: number,
): void {
  if (level <= 1) {
    list.items.push({ content: item.content });
    return;
  }
  let last = list.items.at(-1);
  if (isUndefined(last)) {
    last = { content: [] };
    list.items.push(last);
  }
  last.list ??= { kind: 'list', ordered: item.ordered, items: [] };
  nestWordItem(last.list, item, level - 1);
}

/**
 * Reads a `table` as one paragraph per row, after a paragraph for its caption.
 */
function tableOf<C extends string>(
  node: NodeLike,
  inline: Inline<C>,
  resolve: Resolve<C>,
): RichTextBlock<C>[] {
  const blocks: RichTextBlock<C>[] = [];
  for (const child of node.childNodes) {
    const name = elementName(child);
    if (name === 'tr') blocks.push(rowOf(child, inline, resolve));
    else if (name === 'caption') {
      blocks.push({ kind: 'paragraph', content: leafRuns(child, inline, resolve) });
    } else if (!isUndefined(name) && TABLE_SECTIONS.has(name)) {
      for (const row of child.childNodes) {
        if (elementName(row) === 'tr') blocks.push(rowOf(row, inline, resolve));
      }
    }
  }
  return blocks;
}

/**
 * Reads a `tr` as a paragraph of its cells, joined by ` | `.
 */
function rowOf<C extends string>(
  node: NodeLike,
  inline: Inline<C>,
  resolve: Resolve<C>,
): RichTextParagraph<C> {
  const cells: RichTextRun<C>[][] = [];
  for (const cell of node.childNodes) {
    const name = elementName(cell);
    if (!isUndefined(name) && CELLS.has(name)) {
      cells.push(leafRuns(cell, inlineOf(name, cell, inline, resolve), resolve));
    }
  }
  const separator = (): RichTextRun<C>[] => [{ text: ' | ' }];
  return { kind: 'paragraph', content: mergeRuns(intersperse(cells, separator).flat()) };
}

/**
 * Reads a text node as a raw run, with its whitespace already collapsed outside `pre`.
 * Anything but a text node, and text left empty, gives no run.
 */
function rawText<C extends string>(node: NodeLike, inline: Inline<C>): Raw<C>[] {
  if (node.nodeType !== TEXT) return [];
  const text = (node.nodeValue ?? '').replace(ZERO_WIDTH, '').replaceAll(' ', ' ');
  const kept = inline.pre ? text : text.replace(SPACES, ' ');
  return kept === '' ? [] : [{ text: kept, inline }];
}

/**
 * Whether a raw run holds more than whitespace that collapses away.
 */
function holdsText<C extends string>({ text, inline }: Raw<C>): boolean {
  return inline.pre || text !== ' ';
}

/**
 * Turns the raw runs of one leaf into runs.
 * Spaces collapse into the run holding the first, and vanish at the start and end of each line.
 * One `\n` at the very end is dropped, since a trailing `br` renders no line.
 */
function finishRuns<C extends string>(raws: readonly Raw<C>[]): RichTextRun<C>[] {
  const runs: RichTextRun<C>[] = [];
  let kept = '';
  let pending = false;
  let lineStart = true;
  const trimSpace = (): void => {
    if (kept !== '') kept = kept.slice(0, -1);
    else {
      const last = runs.findLast((run) => run.text !== '');
      if (last) last.text = last.text.slice(0, -1);
    }
    pending = false;
  };
  for (const { text, inline } of raws) {
    if (inline.pre) {
      kept = text;
      pending = false;
      lineStart = text.endsWith('\n');
    } else {
      for (const char of text) {
        if (char === '\n') {
          if (pending) trimSpace();
          kept += char;
          lineStart = true;
        } else if (char === ' ') {
          if (!lineStart && !pending) {
            kept += char;
            pending = true;
          }
        } else {
          kept += char;
          pending = false;
          lineStart = false;
        }
      }
    }
    runs.push({ text: kept, marks: [...inline.marks], link: inline.link });
    kept = '';
  }
  if (pending) trimSpace();
  const last = runs.findLast((run) => run.text !== '');
  if (last?.text.endsWith('\n')) last.text = last.text.slice(0, -1);
  return mergeRuns(runs);
}

/**
 * The inline state inside an element: its marks by name and inline style, and its link for an `a`.
 */
function inlineOf<C extends string>(
  name: string,
  node: NodeLike,
  inline: Inline<C>,
  resolve: Resolve<C>,
): Inline<C> {
  const mark = name === 'pre' ? 'code' : MARK_OF.get(name);
  const marks = mark ? [...inline.marks, mark] : inline.marks;
  const style = node.getAttribute?.('style');
  return {
    marks: style ? styledMarks(marks, style) : marks,
    link: name === 'a' ? (linkOf(node, resolve) ?? inline.link) : inline.link,
    pre: inline.pre || name === 'pre',
  };
}

/**
 * Applies the marks an inline `style` sets or cancels.
 */
function styledMarks(marks: readonly RichTextMark[], style: string): readonly RichTextMark[] {
  let result = marks;
  for (const declaration of style.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon === -1) continue;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration
      .slice(colon + 1)
      .trim()
      .toLowerCase();
    if (property === 'font-weight') {
      const weight = value === 'bold' || value === 'bolder' ? 700 : Number.parseInt(value, 10);
      if (weight >= 600) result = [...result, 'strong'];
      else if (weight <= 500 || value === 'normal' || value === 'lighter')
        result = without(result, 'strong');
    } else if (property === 'font-style') {
      if (value === 'italic' || value === 'oblique') result = [...result, 'em'];
      else if (value === 'normal') result = without(result, 'em');
    } else if (property === 'text-decoration' || property === 'text-decoration-line') {
      if (value.includes('line-through')) result = [...result, 'del'];
    } else if (property === 'font-family') {
      const family = value
        .split(',')[0]
        .trim()
        .replace(/^["']|["']$/g, '');
      if (MONOSPACE.test(family)) result = [...result, 'code'];
    }
  }
  return result;
}

/**
 * `marks` without `mark`.
 */
function without(marks: readonly RichTextMark[], mark: RichTextMark): readonly RichTextMark[] {
  return marks.filter((other) => other !== mark);
}

/**
 * The link an `a` stands for: what `resolve` returns, else a safe URL link, else nothing.
 */
function linkOf<C extends string>(anchor: NodeLike, resolve: Resolve<C>): Link<C> | undefined {
  const resolved = resolve?.(anchor);
  if (resolved) return resolved;
  const href = anchor.getAttribute?.('href')?.trim();
  if (!href) return undefined;
  const url = unwrapGoogle(href);
  if (url.startsWith('#') || !isSafeHref(url)) return undefined;
  return anchor.getAttribute?.('target') === '_blank' ? { url, newTab: true } : { url };
}

/**
 * The address behind a `google.com/url?q=` redirect, or `href` itself.
 */
function unwrapGoogle(href: string): string {
  const url = URL.parse(href);
  if (!url || !GOOGLE_HOST.test(url.hostname) || url.pathname !== '/url') return href;
  return url.searchParams.get('q') ?? href;
}

/**
 * The element's inline `style`, `''` without one.
 */
function styleOf(node: NodeLike): string {
  return node.getAttribute?.('style') ?? '';
}

/**
 * The element's class tokens, lowercased.
 */
function classesOf(node: NodeLike): string[] {
  return (node.getAttribute?.('class') ?? '').toLowerCase().split(SPACES).filter(Boolean);
}

/**
 * The lowercase name of an element, or `undefined` for any other node.
 */
function elementName(node: NodeLike): string | undefined {
  return node.nodeType === ELEMENT ? node.nodeName.toLowerCase() : undefined;
}
