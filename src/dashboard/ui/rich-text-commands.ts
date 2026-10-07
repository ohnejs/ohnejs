import type { Link } from '../../utils/rich-text/link.ts';
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
} from '../../utils/rich-text/rich-text.ts';
import type { Pos, Selection } from './rich-text-model.ts';

import { last } from '../../utils/array/last.ts';
import { mergeRuns } from '../../utils/rich-text/merge-runs.ts';
import {
  RICH_TEXT_DEFAULT_ELEMENTS,
  RICH_TEXT_MAX_LIST_DEPTH,
} from '../../utils/rich-text/rich-text.ts';
import { sliceRuns } from '../../utils/rich-text/slice-runs.ts';
import {
  caret,
  comparePos,
  isCollapsed,
  leafAt,
  leafText,
  leaves,
  linkRangeAt,
  marksAt,
  samePath,
  selectionRange,
} from './rich-text-model.ts';

/**
 * The editor's state: the document, the selection, and what typing at the caret carries.
 */
export interface RichTextState<C extends string = string> {
  /**
   * The document, which always holds at least one leaf.
   * It is never mutated: a command returns a new document that shares every node it did not touch.
   */
  doc: RichText<C>;

  /**
   * The selection in `doc`.
   */
  selection: Selection;

  /**
   * The marks the next typed text takes instead of the marks at the caret.
   * A mark toggled on a caret is stored here, and every other command clears it.
   */
  storedMarks?: readonly RichTextMark[];

  /**
   * How to take back the markdown shortcut that produced `doc`, which Backspace does right after it.
   */
  markdownUndo?: MarkdownUndo<C>;
}

/**
 * What Backspace restores right after a markdown shortcut fired.
 */
export interface MarkdownUndo<C extends string = string> {
  /**
   * The document the shortcut produced.
   * The undo expires as soon as the document is another one.
   */
  doc: RichText<C>;

  /**
   * The caret the shortcut left, where Backspace must be pressed.
   */
  at: Pos;

  /**
   * The document and selection with the marker typed as plain text.
   */
  literal: Pick<RichTextState<C>, 'doc' | 'selection'>;
}

/**
 * A type a leaf can take, by its HTML element, where `p` is a paragraph.
 */
export type RichTextBlockType = 'p' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'blockquote';

/**
 * One leaf in a flat view of the document, where a list item records its depth instead of its nesting.
 */
interface Line<C extends string> {
  kind: 'paragraph' | 'heading' | 'quote' | 'item';
  content: RichTextRun<C>[];
  level?: RichTextHeadingLevel;
  depth: number;
  ordered: boolean;
  group?: object;
  source?: object;
}

interface Point {
  line: number;
  offset: number;
}

interface Draft<C extends string> {
  lines: Line<C>[];
  paths: number[][];
}

interface Built<C extends string> {
  doc: RichText<C>;
  paths: number[][];
}

interface Opened<C extends string> extends Draft<C> {
  from: Point;
  to: Point;
  anchor: Point;
  head: Point;
}

const HEADINGS = ['h2', 'h3', 'h4', 'h5', 'h6'] as const;
const BULLETS = ['-', '*', '+'];
const NUMBERS = ['1.', '1)'];

/**
 * The state of an editor opened on `value`, with the caret at the start.
 * A value without a leaf gains an empty paragraph, since a caret needs a leaf to sit in.
 */
export function createRichTextState<C extends string>(value: RichText<C>): RichTextState<C> {
  const doc: RichText<C> =
    leaves(value).length > 0 ? value : [...value, { kind: 'paragraph', content: [] }];
  return { doc, selection: caret({ path: leaves(doc)[0]!.path, offset: 0 }) };
}

/**
 * Replaces the text between two positions with `text`, leaving the caret after it.
 * The new text takes the stored marks, else the marks of the run where the edit happened.
 * It takes that run's link only when the edit sits inside the link, so typing after a link never extends it.
 * Positions in different leaves join those leaves first.
 */
export function replaceText<C extends string>(
  state: RichTextState<C>,
  from: Pos,
  to: Pos,
  text: string,
): RichTextState<C> {
  const [start, end] = comparePos(from, to) <= 0 ? [from, to] : [to, from];
  if (text === '' && comparePos(start, end) === 0) return state;
  const run = typedRun(state, start, end, text);
  const { lines, paths } = flatten(state.doc);
  const at = pointOf(paths, start);
  deleteBetween(lines, at, pointOf(paths, end));
  if (text !== '') insertRuns(lines[at.line]!, at.offset, [run]);
  return commit(lines, { line: at.line, offset: at.offset + text.length });
}

/**
 * Replaces the selection with `text`, as `replaceText` does.
 */
export function insertText<C extends string>(
  state: RichTextState<C>,
  text: string,
): RichTextState<C> {
  const { from, to } = selectionRange(state.selection);
  return replaceText(state, from, to, text);
}

/**
 * Deletes the selection, joining the leaves it spans into the first.
 */
export function deleteSelection<C extends string>(state: RichTextState<C>): RichTextState<C> {
  return insertText(state, '');
}

/**
 * Backspace.
 * Right after a markdown shortcut, it restores the marker as text.
 * At a list item's start it lifts the item, keeping its text.
 * At another leaf's start it joins the leaf into the leaf before, which is a list's last and deepest item.
 * At the first leaf's start, a heading or a quote becomes a paragraph.
 */
export function deleteBackward<C extends string>(state: RichTextState<C>): RichTextState<C> {
  const { selection, markdownUndo } = state;
  if (
    markdownUndo?.doc === state.doc &&
    isCollapsed(selection) &&
    comparePos(selection.head, markdownUndo.at) === 0
  ) {
    return markdownUndo.literal;
  }
  if (!isCollapsed(selection)) return deleteSelection(state);
  const { path, offset } = selection.head;
  if (offset > 0) {
    const pair = offset > 1 && leafText(leafAt(state.doc, path)!).codePointAt(offset - 2)! > 0xffff;
    return replaceText(state, { path, offset: offset - (pair ? 2 : 1) }, selection.head, '');
  }
  const { lines, head } = open(state);
  const line = lines[head.line]!;
  if (line.kind === 'item') {
    lift(lines, head.line, head.line);
    return commit(lines, head);
  }
  if (head.line === 0) {
    if (line.kind === 'paragraph') return state;
    reshape(line, 'p');
    return commit(lines, head);
  }
  const previous = lines[head.line - 1]!;
  if (previous.kind !== 'item' && previous.content.length === 0) {
    lines.splice(head.line - 1, 1);
    return commit(lines, { line: head.line - 1, offset: 0 });
  }
  const joint = { line: head.line - 1, offset: length(previous.content) };
  deleteBetween(lines, joint, head);
  return commit(lines, joint);
}

/**
 * Delete.
 * At a leaf's end, it joins the next leaf into this one.
 * An empty leaf before another leaf that is not a list item gives way to it instead.
 */
export function deleteForward<C extends string>(state: RichTextState<C>): RichTextState<C> {
  const { selection } = state;
  if (!isCollapsed(selection)) return deleteSelection(state);
  const { path, offset } = selection.head;
  const text = leafText(leafAt(state.doc, path)!);
  if (offset < text.length) {
    const size = text.codePointAt(offset)! > 0xffff ? 2 : 1;
    return replaceText(state, selection.head, { path, offset: offset + size }, '');
  }
  const { lines, head } = open(state);
  const line = lines[head.line]!;
  const next = lines[head.line + 1];
  if (!next) return state;
  if (line.kind !== 'item' && line.content.length === 0 && next.kind !== 'item') {
    lines.splice(head.line, 1);
    return commit(lines, head);
  }
  deleteBetween(lines, head, { line: head.line + 1, offset: 0 });
  return commit(lines, head);
}

/**
 * Enter: splits the leaf at the caret, and the new leaf takes the sublist of a split item.
 * At the end of a heading or quote, the new leaf is a paragraph.
 * At the start of one, an empty paragraph goes above it.
 * On an empty list item, it lifts the item instead.
 * In an inline value, it inserts `\n` when `lineBreaks` allows it, and otherwise does nothing.
 */
export function splitBlock<C extends string>(
  state: RichTextState<C>,
  options: RichTextOptions = {},
): RichTextState<C> {
  const { inline = false, lineBreaks = true } = options;
  if (inline) return lineBreaks ? insertText(state, '\n') : state;
  const { lines, from, to } = open(state);
  deleteBetween(lines, from, to);
  const line = lines[from.line]!;
  const size = length(line.content);
  if (line.kind === 'item' && size === 0) {
    lift(lines, from.line, from.line);
    return commit(lines, from);
  }
  if (from.offset === 0 && size > 0) {
    const empty: Line<C> = { ...line, content: [], source: undefined };
    if (line.kind !== 'item') reshape(empty, 'p');
    lines.splice(from.line, 0, empty);
    return commit(lines, { line: from.line + 1, offset: 0 });
  }
  const next: Line<C> = {
    ...line,
    content: sliceRuns(line.content, from.offset),
    source: undefined,
  };
  if (from.offset === size && (line.kind === 'heading' || line.kind === 'quote'))
    reshape(next, 'p');
  // A line split at its end keeps its content, so `commit` reuses its block.
  if (from.offset < size) line.content = sliceRuns(line.content, 0, from.offset);
  lines.splice(from.line + 1, 0, next);
  return commit(lines, { line: from.line + 1, offset: 0 });
}

/**
 * Shift-Enter: inserts `\n` when `lineBreaks` allows it.
 * Without line breaks, it splits the leaf as Enter does, and does nothing in an inline value.
 */
export function insertLineBreak<C extends string>(
  state: RichTextState<C>,
  options: RichTextOptions = {},
): RichTextState<C> {
  const { inline = false, lineBreaks = true } = options;
  if (lineBreaks) return insertText(state, '\n');
  return inline ? state : splitBlock(state, options);
}

/**
 * Tab: nests the selected list items under the item before them, together with their sublists.
 * Returns `undefined` when it cannot, so the caller lets focus move on.
 * It cannot outside a list, without an item before at the same level, or past the deepest level lists allow.
 */
export function sinkItem<C extends string>(state: RichTextState<C>): RichTextState<C> | undefined {
  const { lines, from, to, anchor, head } = open(state);
  if (!isOneList(lines, from.line, to.line)) return undefined;
  const line = lines[from.line]!;
  const previous = lines[from.line - 1];
  if (previous?.kind !== 'item' || previous.group !== line.group || previous.depth < line.depth) {
    return undefined;
  }
  const region = lines.slice(from.line, subtreeEnd(lines, from.line, to.line));
  if (region.some((item) => item.depth + 1 >= RICH_TEXT_MAX_LIST_DEPTH)) return undefined;
  for (const item of region) item.depth++;
  return commit(lines, anchor, head);
}

/**
 * Shift-Tab: moves the selected list items one level out, together with their sublists.
 * The items after them at their level become their sublist, and an item at the top level becomes a paragraph.
 * Returns `undefined` outside a list, so the caller lets focus move on.
 */
export function liftItem<C extends string>(state: RichTextState<C>): RichTextState<C> | undefined {
  const { lines, from, to, anchor, head } = open(state);
  if (!isOneList(lines, from.line, to.line)) return undefined;
  lift(lines, from.line, to.line);
  return commit(lines, anchor, head);
}

/**
 * Turns the selected leaves into one list of the given type, joining a neighbouring list of that type.
 * Selected items of the other type switch their whole list level over.
 * When every selected leaf is already an item of that type, they become paragraphs instead.
 */
export function toggleList<C extends string>(
  state: RichTextState<C>,
  ordered: boolean,
): RichTextState<C> {
  const { lines, from, to, anchor, head } = open(state);
  const selected = lines.slice(from.line, to.line + 1);
  if (selected.every((line) => line.kind === 'item' && line.ordered === ordered)) {
    for (const line of selected) reshape(line, 'p');
  } else {
    listify(lines, from.line, to.line, ordered);
  }
  return commit(lines, anchor, head);
}

/**
 * Gives every selected leaf the type `type`, taking list items out of their list.
 */
export function setBlockType<C extends string>(
  state: RichTextState<C>,
  type: RichTextBlockType,
): RichTextState<C> {
  const { lines, from, to, anchor, head } = open(state);
  for (const line of lines.slice(from.line, to.line + 1)) reshape(line, type);
  return commit(lines, anchor, head);
}

/**
 * Adds `mark` to the selected text, or removes it when all of that text already has it.
 * On a caret, it toggles the mark in the stored marks instead.
 */
export function toggleMark<C extends string>(
  state: RichTextState<C>,
  mark: RichTextMark,
): RichTextState<C> {
  const { doc, selection, storedMarks } = state;
  if (isCollapsed(selection)) {
    const marks = storedMarks ?? marksAt(doc, selection.head);
    const toggled = marks.includes(mark)
      ? marks.filter((other) => other !== mark)
      : [...marks, mark];
    return { doc, selection, storedMarks: toggled };
  }
  const { lines, from, to } = open(state);
  const active = runsBetween(lines, from, to).every((run) => run.marks?.includes(mark));
  mapBetween(lines, from, to, (run) => ({
    ...run,
    marks: active ? run.marks?.filter((other) => other !== mark) : [...(run.marks ?? []), mark],
  }));
  return { doc: build(lines).doc, selection };
}

/**
 * Removes every mark from the selected text, and never a link.
 * On a caret, it stores no marks instead.
 */
export function clearMarks<C extends string>(state: RichTextState<C>): RichTextState<C> {
  const { doc, selection } = state;
  if (isCollapsed(selection)) return { doc, selection, storedMarks: [] };
  const { lines, from, to } = open(state);
  mapBetween(lines, from, to, (run) => ({ ...run, marks: [] }));
  return { doc: build(lines).doc, selection };
}

/**
 * Links the selected text to `link`.
 * On a caret inside a link, it points that whole link at `link`.
 * On a caret elsewhere, it inserts `text` as a link, and does nothing without it.
 */
export function setLink<C extends string>(
  state: RichTextState<C>,
  link: Link<C>,
  text = '',
): RichTextState<C> {
  const { doc, selection } = state;
  const range = isCollapsed(selection) ? linkRangeAt(doc, selection.head) : undefined;
  if (isCollapsed(selection) && !range) {
    if (text === '') return state;
    const { lines, head } = open(state);
    insertRuns(lines[head.line]!, head.offset, [
      { ...typedRun(state, selection.head, selection.head, text), link },
    ]);
    return commit(lines, { line: head.line, offset: head.offset + text.length });
  }
  return relink(state, range, link);
}

/**
 * Removes the links from the selected text, or the whole link around a caret.
 */
export function removeLink<C extends string>(state: RichTextState<C>): RichTextState<C> {
  const { doc, selection } = state;
  const range = isCollapsed(selection) ? linkRangeAt(doc, selection.head) : undefined;
  if (isCollapsed(selection) && !range) return state;
  return relink(state, range, undefined);
}

/**
 * Replaces the selection with a slice of blocks, leaving the caret after it.
 * The first slice leaf continues the leaf before the caret, and the last one takes the text after it.
 * An empty leaf that is not a list item takes the type of the slice's first leaf.
 * Inside a list, the slice's leaves become items at the caret's level, and its items keep their nesting.
 */
export function insertSlice<C extends string>(
  state: RichTextState<C>,
  slice: RichText<C>,
): RichTextState<C> {
  const { lines, from, to } = open(state);
  deleteBetween(lines, from, to);
  const line = lines[from.line]!;
  const pasted = flatten(slice).lines.map((piece): Line<C> => {
    const content = mergeRuns(piece.content);
    if (line.kind !== 'item') return { ...piece, content, source: undefined };
    const nested = piece.kind === 'item' && piece.depth > 0;
    return {
      kind: 'item',
      content,
      depth: line.depth + (piece.kind === 'item' ? piece.depth : 0),
      ordered: nested ? piece.ordered : line.ordered,
      group: line.group,
    };
  });
  const first = pasted[0];
  const end = last(pasted);
  if (!first || !end) return commit(lines, from);
  const before = sliceRuns(line.content, 0, from.offset);
  const after = sliceRuns(line.content, from.offset);
  const empty = before.length === 0 && (pasted.length > 1 || after.length === 0);
  const opening: Line<C> = {
    ...(line.kind !== 'item' && empty ? first : line),
    content: mergeRuns([...before, ...first.content]),
    source: line.source,
  };
  if (pasted.length === 1) {
    opening.content = mergeRuns([...opening.content, ...after]);
    lines[from.line] = opening;
    return commit(lines, { line: from.line, offset: length(before) + length(first.content) });
  }
  const closing: Line<C> = { ...end, content: mergeRuns([...end.content, ...after]) };
  lines.splice(from.line, 1, opening, ...pasted.slice(1, -1), closing);
  return commit(lines, { line: from.line + pasted.length - 1, offset: length(end.content) });
}

/**
 * Runs the markdown shortcut that typing a space at the caret fires, or returns `undefined` when none does.
 * It fires in a paragraph whose text before the caret is exactly a marker, when its result is allowed.
 * `#` gives the highest allowed heading, `##` to `######` that level, `-`, `*` and `+` a bulleted list.
 * `1.` and `1)` give a numbered list, and `>` a quote.
 * The marker is removed, and Backspace right after restores it with the space as text.
 */
export function markdownShortcut<C extends string>(
  state: RichTextState<C>,
  options: RichTextOptions = {},
): RichTextState<C> | undefined {
  const { inline = false, elements = RICH_TEXT_DEFAULT_ELEMENTS } = options;
  const { doc, selection } = state;
  const { head } = selection;
  const leaf = leafAt(doc, head.path);
  if (
    inline ||
    !isCollapsed(selection) ||
    !leaf ||
    !('kind' in leaf) ||
    leaf.kind !== 'paragraph'
  ) {
    return undefined;
  }
  const element = shortcutElement(leafText(leaf).slice(0, head.offset), elements);
  if (!element || !elements.includes(element)) return undefined;
  const stripped = replaceText(state, { path: head.path, offset: 0 }, head, '');
  const done =
    element === 'ul' || element === 'ol'
      ? toggleList(stripped, element === 'ol')
      : setBlockType(stripped, element);
  const { doc: literal, selection: typed } = insertText(state, ' ');
  return {
    ...done,
    markdownUndo: {
      doc: done.doc,
      at: done.selection.head,
      literal: { doc: literal, selection: typed },
    },
  };
}

/**
 * The element a marker asks for, or `undefined` when it is not a marker.
 */
function shortcutElement(
  marker: string,
  elements: readonly RichTextElement[],
): RichTextElement | undefined {
  if (marker === '#') return HEADINGS.find((heading) => elements.includes(heading));
  if (marker.length >= 2 && marker.length <= 6 && marker === '#'.repeat(marker.length)) {
    return HEADINGS[marker.length - 2];
  }
  if (BULLETS.includes(marker)) return 'ul';
  if (NUMBERS.includes(marker)) return 'ol';
  return marker === '>' ? 'blockquote' : undefined;
}

/**
 * The run that text typed between two positions becomes, before it is inserted.
 */
function typedRun<C extends string>(
  state: RichTextState<C>,
  from: Pos,
  to: Pos,
  text: string,
): RichTextRun<C> {
  const { doc, storedMarks } = state;
  const collapsed = comparePos(from, to) === 0;
  const edited = collapsed ? from : { path: from.path, offset: from.offset + 1 };
  const marks = storedMarks ?? marksAt(doc, edited);
  const range = linkRangeAt(doc, edited);
  const inside =
    range &&
    samePath(from.path, to.path) &&
    (collapsed
      ? range.from < from.offset && from.offset < range.to
      : range.from <= from.offset && to.offset <= range.to);
  return { text, marks: [...marks], ...(inside ? { link: range.link } : {}) };
}

/**
 * Sets the link of the text in `range` on the caret's leaf, or of the selected text, to `link`.
 */
function relink<C extends string>(
  state: RichTextState<C>,
  range: { from: number; to: number } | undefined,
  link: Link<C> | undefined,
): RichTextState<C> {
  const { lines, from, to, head } = open(state);
  const start = range ? { line: head.line, offset: range.from } : from;
  const end = range ? { line: head.line, offset: range.to } : to;
  mapBetween(lines, start, end, (run) => ({ ...run, link }));
  return { doc: build(lines).doc, selection: state.selection };
}

/**
 * Makes the leaves between two lines items of one list, widened to whole lists and joined with neighbours.
 */
function listify<C extends string>(
  lines: Line<C>[],
  first: number,
  final: number,
  ordered: boolean,
): void {
  for (let index = first; index <= final; index++) {
    const line = lines[index]!;
    if (line.kind === 'item') {
      for (const sibling of siblings(lines, index)) sibling.ordered = ordered;
    } else {
      Object.assign(line, { kind: 'item', level: undefined, depth: 0, ordered, group: undefined });
    }
  }
  let start = first;
  let end = final + 1;
  const joins = (line: Line<C> | undefined, group: object | undefined) =>
    line?.kind === 'item' && group !== undefined && line.group === group;
  while (joins(lines[start - 1], lines[start]!.group)) start--;
  while (joins(lines[end], lines[end - 1]!.group)) end++;
  const previous = lines[start - 1];
  if (previous?.kind === 'item' && listOrdered(lines, previous.group) === ordered) {
    while (joins(lines[start - 1], previous.group)) start--;
  }
  const next = lines[end];
  if (next?.kind === 'item' && listOrdered(lines, next.group) === ordered) {
    while (joins(lines[end], next.group)) end++;
  }
  const span = lines.slice(start, end);
  const group = span.find((line) => line.group)?.group ?? {};
  for (const line of span) line.group = group;
}

/**
 * Whether the top level of the list `group` is numbered.
 */
function listOrdered<C extends string>(
  lines: readonly Line<C>[],
  group: object | undefined,
): boolean {
  return lines.find((line) => line.kind === 'item' && line.group === group)!.ordered;
}

/**
 * The items that share a parent with the item at `index`, itself included.
 */
function siblings<C extends string>(lines: readonly Line<C>[], index: number): Line<C>[] {
  const { depth, group } = lines[index]!;
  const within = (line: Line<C> | undefined) =>
    line?.kind === 'item' && line.group === group && line.depth >= depth;
  let start = index;
  let end = index + 1;
  while (within(lines[start - 1])) start--;
  while (within(lines[end])) end++;
  return lines.slice(start, end).filter((line) => line.depth === depth);
}

/**
 * Moves the items between two lines one level out, with their sublists.
 */
function lift<C extends string>(lines: Line<C>[], first: number, final: number): void {
  for (const line of lines.slice(first, subtreeEnd(lines, first, final))) {
    if (line.depth > 0) line.depth--;
    else reshape(line, 'p');
  }
}

/**
 * The index after the items nested under the items between two lines.
 */
function subtreeEnd<C extends string>(
  lines: readonly Line<C>[],
  first: number,
  final: number,
): number {
  const lowest = Math.min(...lines.slice(first, final + 1).map((line) => line.depth));
  const { group } = lines[final]!;
  let end = final + 1;
  while (lines[end]?.kind === 'item' && lines[end]!.group === group && lines[end]!.depth > lowest) {
    end++;
  }
  return end;
}

/**
 * Whether every leaf between two lines is an item of one list.
 */
function isOneList<C extends string>(
  lines: readonly Line<C>[],
  first: number,
  final: number,
): boolean {
  const { group } = lines[first]!;
  return lines
    .slice(first, final + 1)
    .every((line) => line.kind === 'item' && line.group === group);
}

/**
 * Gives a line the shape of a block type, out of any list.
 */
function reshape<C extends string>(line: Line<C>, type: RichTextBlockType): void {
  const level = type.startsWith('h') ? (Number(type[1]) as RichTextHeadingLevel) : undefined;
  const kind = level ? 'heading' : type === 'blockquote' ? 'quote' : 'paragraph';
  Object.assign(line, { kind, level, depth: 0, ordered: false, group: undefined });
}

/**
 * Deletes the text between two points, joining the second point's line into the first.
 */
function deleteBetween<C extends string>(lines: Line<C>[], from: Point, to: Point): void {
  if (from.line === to.line && from.offset === to.offset) return;
  const first = lines[from.line]!;
  const after = sliceRuns(lines[to.line]!.content, to.offset);
  first.content = mergeRuns([...sliceRuns(first.content, 0, from.offset), ...after]);
  lines.splice(from.line + 1, to.line - from.line);
}

/**
 * Inserts runs into a line at `offset`.
 */
function insertRuns<C extends string>(
  line: Line<C>,
  offset: number,
  runs: readonly RichTextRun<C>[],
): void {
  line.content = mergeRuns([
    ...sliceRuns(line.content, 0, offset),
    ...runs,
    ...sliceRuns(line.content, offset),
  ]);
}

/**
 * The runs between two points, cut at both ends.
 */
function runsBetween<C extends string>(
  lines: readonly Line<C>[],
  from: Point,
  to: Point,
): RichTextRun<C>[] {
  return lines.slice(from.line, to.line + 1).flatMap((line, index) => {
    const start = index === 0 ? from.offset : 0;
    return sliceRuns(line.content, start, from.line + index === to.line ? to.offset : Infinity);
  });
}

/**
 * Rewrites each run between two points, cutting the runs at both ends first.
 * A line whose part of the range holds no text keeps its content as it is.
 */
function mapBetween<C extends string>(
  lines: Line<C>[],
  from: Point,
  to: Point,
  map: (run: RichTextRun<C>) => RichTextRun<C>,
): void {
  for (let index = from.line; index <= to.line; index++) {
    const line = lines[index]!;
    const start = index === from.line ? from.offset : 0;
    const end = Math.min(index === to.line ? to.offset : Infinity, length(line.content));
    if (start >= end) continue;
    line.content = mergeRuns([
      ...sliceRuns(line.content, 0, start),
      ...sliceRuns(line.content, start, end).map(map),
      ...sliceRuns(line.content, end),
    ]);
  }
}

/**
 * The length of the text in a list of runs.
 */
function length(runs: readonly RichTextRun[]): number {
  return runs.reduce((sum, run) => sum + run.text.length, 0);
}

/**
 * Opens the state for editing: its flat lines and its selection as points in them.
 */
function open<C extends string>(state: RichTextState<C>): Opened<C> {
  const draft = flatten(state.doc);
  const { anchor, head } = state.selection;
  const { from, to } = selectionRange(state.selection);
  const point = (pos: Pos) => pointOf(draft.paths, pos);
  return { ...draft, from: point(from), to: point(to), anchor: point(anchor), head: point(head) };
}

/**
 * Builds the edited lines into a new state, with the selection between two points.
 */
function commit<C extends string>(
  lines: readonly Line<C>[],
  anchor: Point,
  head = anchor,
): RichTextState<C> {
  const { doc, paths } = build(lines);
  const pos = ({ line, offset }: Point): Pos => ({ path: paths[line]!, offset });
  return { doc, selection: { anchor: pos(anchor), head: pos(head) } };
}

/**
 * The point in the lines where a position sits.
 */
function pointOf(paths: readonly number[][], pos: Pos): Point {
  return { line: paths.findIndex((path) => samePath(path, pos.path)), offset: pos.offset };
}

/**
 * The document as lines in document order, each with its path.
 * Every line remembers the node it came from, and an item the list at its top level as its group.
 */
function flatten<C extends string>(doc: RichText<C>): Draft<C> {
  const draft: Draft<C> = { lines: [], paths: [] };
  doc.forEach((block, index) => {
    if (block.kind === 'list') return flattenList(block, block, 0, [index], draft);
    const { kind, content } = block;
    const level = kind === 'heading' ? block.level : undefined;
    draft.lines.push({ kind, content, level, depth: 0, ordered: false, source: block });
    draft.paths.push([index]);
  });
  return draft;
}

/**
 * Adds the items of a list nested `depth` lists deep to the draft.
 */
function flattenList<C extends string>(
  list: RichTextList<C>,
  group: RichTextList<C>,
  depth: number,
  path: readonly number[],
  draft: Draft<C>,
): void {
  list.items.forEach((item, index) => {
    const { content } = item;
    draft.lines.push({ kind: 'item', content, depth, ordered: list.ordered, group, source: item });
    draft.paths.push([...path, index]);
    if (item.list) flattenList(item.list, group, depth + 1, [...path, index], draft);
  });
}

/**
 * Builds lines back into a document, with the path of each line.
 * A node is reused while nothing in it changed, and never twice, so no object appears twice in a document.
 * Neighbouring items of one group form one list.
 * An item nests under the closest item before it with a lower depth, and never past the deepest level.
 */
function build<C extends string>(lines: readonly Line<C>[]): Built<C> {
  const used = new Set<object>();
  const doc: RichText<C> = [];
  const paths: number[][] = [];
  for (let start = 0; start < lines.length; ) {
    const line = lines[start]!;
    if (line.kind !== 'item') {
      paths[start] = [doc.length];
      doc.push(buildBlock(line, used));
      start++;
      continue;
    }
    let end = start + 1;
    while (lines[end]?.kind === 'item' && lines[end]!.group === line.group) end++;
    const run = lines.slice(start, end);
    const depths = nestDepths(run);
    const cursor = { index: 0 };
    const items = buildItems(run, depths, cursor, 0, [doc.length], used, (index, path) => {
      paths[start + index] = path;
    });
    doc.push(reuseList(line.group, line.ordered, items, used));
    start = end;
  }
  return { doc, paths };
}

/**
 * Builds the items at `depth` from the cursor on, each with the sublist the deeper items after it form.
 */
function buildItems<C extends string>(
  lines: readonly Line<C>[],
  depths: readonly number[],
  cursor: { index: number },
  depth: number,
  path: readonly number[],
  used: Set<object>,
  place: (index: number, path: number[]) => void,
): RichTextListItem<C>[] {
  const items: RichTextListItem<C>[] = [];
  while (depths[cursor.index] === depth) {
    const at = cursor.index++;
    const line = lines[at]!;
    const itemPath = [...path, items.length];
    place(at, itemPath);
    const source = isItem<C>(line.source) ? line.source : undefined;
    let list: RichTextList<C> | undefined;
    if (depths[cursor.index]! > depth) {
      const { ordered } = lines[cursor.index]!;
      const children = buildItems(lines, depths, cursor, depth + 1, itemPath, used, place);
      list = reuseList(source?.list, ordered, children, used);
    }
    items.push(reuseItem(source, line.content, list, used));
  }
  return items;
}

/**
 * The depth each item of one list renders at.
 * An item sits one level below the closest item before it with a lower recorded depth, capped at the deepest.
 */
function nestDepths<C extends string>(lines: readonly Line<C>[]): number[] {
  const stack: { recorded: number; depth: number }[] = [];
  return lines.map((line) => {
    while (stack.length > 0 && last(stack)!.recorded >= line.depth) stack.pop();
    const parent = last(stack);
    const depth = parent ? Math.min(parent.depth + 1, RICH_TEXT_MAX_LIST_DEPTH - 1) : 0;
    stack.push({ recorded: line.depth, depth });
    return depth;
  });
}

/**
 * The block a line that is not an item builds into, reusing its source while it is unchanged.
 */
function buildBlock<C extends string>(line: Line<C>, used: Set<object>): RichTextBlock<C> {
  const { kind, content, level, source } = line;
  const block = source as RichTextBlock<C> | undefined;
  if (
    block &&
    !used.has(block) &&
    block.kind === kind &&
    block.content === content &&
    (block.kind !== 'heading' || block.level === level)
  ) {
    used.add(block);
    return block;
  }
  if (kind === 'heading') return { kind, level: level!, content };
  return { kind: kind === 'quote' ? 'quote' : 'paragraph', content };
}

/**
 * An item of `content` and `list`, reusing `source` while it is unchanged.
 */
function reuseItem<C extends string>(
  source: RichTextListItem<C> | undefined,
  content: RichTextRun<C>[],
  list: RichTextList<C> | undefined,
  used: Set<object>,
): RichTextListItem<C> {
  if (source && !used.has(source) && source.content === content && source.list === list) {
    used.add(source);
    return source;
  }
  return list ? { content, list } : { content };
}

/**
 * A list of `items`, reusing `source` while it is unchanged.
 */
function reuseList<C extends string>(
  source: object | undefined,
  ordered: boolean,
  items: RichTextListItem<C>[],
  used: Set<object>,
): RichTextList<C> {
  const list = source as RichTextList<C> | undefined;
  if (
    list?.kind === 'list' &&
    !used.has(list) &&
    list.ordered === ordered &&
    list.items.length === items.length &&
    list.items.every((item, index) => item === items[index])
  ) {
    used.add(list);
    return list;
  }
  return { kind: 'list', ordered, items };
}

/**
 * Whether a line's source is a list item.
 */
function isItem<C extends string>(source: object | undefined): source is RichTextListItem<C> {
  return source !== undefined && !('kind' in source);
}
