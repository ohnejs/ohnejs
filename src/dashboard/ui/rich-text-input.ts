import type { NodeLike } from '../../utils/html/node-like.ts';
import type { Link, RecordLink } from '../../utils/rich-text/link.ts';
import type {
  RichText,
  RichTextBlock,
  RichTextElement,
  RichTextList,
  RichTextListItem,
  RichTextMark,
  RichTextOptions,
  RichTextRun,
} from '../../utils/rich-text/rich-text.ts';
import type { RichTextState } from './rich-text-commands.ts';
import type { RichTextView } from './rich-text-dom.ts';
import type { Leaf, Pos, Selection } from './rich-text-model.ts';

import { last } from '../../utils/array/last.ts';
import { jsonDepthWithin } from '../../utils/json/json-depth-within.ts';
import { jsonDeserialize } from '../../utils/json/json-deserialize.ts';
import { checkLink } from '../../utils/rich-text/check-link.ts';
import { conformRichText } from '../../utils/rich-text/conform-rich-text.ts';
import { htmlToRichText } from '../../utils/rich-text/html-to-rich-text.ts';
import { isRecordLink } from '../../utils/rich-text/is-record-link.ts';
import { isRichText } from '../../utils/rich-text/is-rich-text.ts';
import { normalizeRichText } from '../../utils/rich-text/normalize-rich-text.ts';
import { richTextToHTML } from '../../utils/rich-text/rich-text-to-html.ts';
import { richTextToText } from '../../utils/rich-text/rich-text-to-text.ts';
import { textToRichText } from '../../utils/rich-text/text-to-rich-text.ts';
import {
  clearMarks,
  createRichTextState,
  deleteBackward,
  deleteForward,
  deleteSelection,
  insertLineBreak,
  insertSlice,
  insertText,
  liftItem,
  markdownShortcut,
  replaceText,
  setBlockType,
  setLink,
  sinkItem,
  splitBlock,
  toggleList,
  toggleMark,
} from './rich-text-commands.ts';
import { richTextKeys } from './rich-text-keys.ts';
import {
  caret,
  comparePos,
  diffText,
  domText,
  isCollapsed,
  leafAt,
  leafText,
  leaves,
  samePath,
  selectionRange,
} from './rich-text-model.ts';

/**
 * An edit of the editor's state, or `undefined` when it does not apply.
 */
export type RichTextCommand<C extends string = string> = (
  state: RichTextState<C>,
) => RichTextState<C> | undefined;

/**
 * What the input layer drives: the editor's surface, view and state.
 */
export interface RichTextInputHost<C extends string = string> {
  /**
   * The `contenteditable` element.
   */
  surface: HTMLElement;

  /**
   * The view rendered into `surface`.
   */
  view: RichTextView<C>;

  /**
   * The field's options, which gate every command and clip every paste.
   */
  options: RichTextOptions;

  /**
   * Whether an input method is composing.
   * The input layer sets it, and the host neither renders nor writes the selection while it holds.
   */
  composing: boolean;

  /**
   * Whether the editor is read-only.
   */
  disabled(): boolean;

  /**
   * The current state, without reading the DOM.
   */
  state(): RichTextState<C>;

  /**
   * The current state, with the selection read from the DOM first.
   */
  read(): RichTextState<C>;

  /**
   * Runs a command as a transaction, returning whether it applied.
   */
  transact(command: RichTextCommand<C>): boolean;

  /**
   * Takes on a state the DOM already shows, as read-back and resync produce it.
   * `typed` is the leaf whose text the browser typed, re-rendered only when its markup is off.
   */
  accept(state: RichTextState<C>, typed?: Leaf<C>): void;

  /**
   * Opens the link popup, returning whether one opened.
   */
  link(): boolean;

  /**
   * Moves focus into the toolbar, returning whether there is one.
   */
  focusToolbar(): boolean;

  /**
   * Reads a dashboard record URL as the link to its record.
   */
  record?(url: string): RecordLink<C> | undefined;

  /**
   * The text a pasted record link inserts at a caret.
   */
  label?(link: RecordLink<C>): string | undefined;
}

const FLAVOR = 'application/x-ohne-rich-text';
const MAX_HTML = 2 * 1024 * 1024;
const MAX_JSON_DEPTH = 32;
const LONE_URL = /^https?:\/\/\S+$/i;
const COMPOSING = 'ohne-rich-text-composing';
const NATIVE = new Set(['insertReplacementText', 'insertTranspose', 'insertCompositionText']);
const DEFAULT_ELEMENTS: readonly RichTextElement[] = ['h2', 'h3', 'ul', 'ol', 'blockquote'];
const DEFAULT_MARKS: readonly RichTextMark[] = ['strong', 'em', 'code'];

/**
 * The part of a document a selection covers, with its first and last leaves cut at the selection's ends.
 * An item outside the selection gives way to its selected sublist items, which take its place.
 *
 * @example
 * ```ts
 * const doc: RichText = [
 *   { kind: 'heading', level: 2, content: [{ text: 'Hello' }] },
 *   { kind: 'paragraph', content: [{ text: 'world', marks: ['em'] }] },
 * ]
 *
 * sliceRichText(doc, { anchor: { path: [0], offset: 3 }, head: { path: [1], offset: 2 } })
 * // -> [
 * //   { kind: 'heading', level: 2, content: [{ text: 'lo' }] },
 * //   { kind: 'paragraph', content: [{ text: 'wo', marks: ['em'] }] },
 * // ]
 * ```
 */
export function sliceRichText<C extends string>(
  doc: RichText<C>,
  selection: Selection,
): RichText<C> {
  const { from, to } = selectionRange(selection);
  const start = { path: from.path, offset: 0 };
  const end = { path: to.path, offset: 0 };
  const inside = (path: readonly number[]) =>
    comparePos({ path, offset: 0 }, start) >= 0 && comparePos({ path, offset: 0 }, end) <= 0;
  const cut = (content: readonly RichTextRun<C>[], path: readonly number[]) =>
    cutRuns(
      content,
      samePath(path, from.path) ? from.offset : 0,
      samePath(path, to.path) ? to.offset : Infinity,
    );
  const items = (list: RichTextList<C>, path: readonly number[]): RichTextListItem<C>[] =>
    list.items.flatMap((item, index) => {
      const itemPath = [...path, index];
      const nested = item.list ? items(item.list, itemPath) : [];
      if (!inside(itemPath)) return nested;
      const content = cut(item.content, itemPath);
      if (!item.list || nested.length === 0) return [{ content }];
      return [{ content, list: { kind: 'list', ordered: item.list.ordered, items: nested } }];
    });
  return doc.flatMap((block, index): RichTextBlock<C>[] => {
    if (block.kind !== 'list') {
      return inside([index]) ? [{ ...block, content: cut(block.content, [index]) }] : [];
    }
    const kept = items(block, [index]);
    return kept.length > 0 ? [{ ...block, items: kept }] : [];
  });
}

/**
 * Wires the editor's surface to its model: input, composition, read-back, resync, keys, clipboard and drop.
 * Native typing runs only where the browser's result is certain to match the model, and is then read back.
 * Every other input type is cancelled, and handled through a command where one exists.
 * During composition nothing is cancelled, rendered or selected.
 * The composed text is read back once the composition ends.
 */
export function bindRichTextInput<C extends string>(host: RichTextInputHost<C>): void {
  const { surface, view, options } = host;
  const { ownerDocument } = surface;
  const { inline = false, elements = DEFAULT_ELEMENTS, marks = DEFAULT_MARKS } = options;
  const commands = new Map<string, RichTextCommand<C>>([
    ['insertParagraph', (state) => splitBlock(state, options)],
    ['insertLineBreak', (state) => insertLineBreak(state, options)],
    ['formatIndent', sinkItem],
    ['formatOutdent', liftItem],
    ['formatRemove', clearMarks],
  ]);
  if (!inline && elements.includes('ol'))
    commands.set('insertOrderedList', (state) => toggleList(state, true));
  if (!inline && elements.includes('ul'))
    commands.set('insertUnorderedList', (state) => toggleList(state, false));
  for (const [type, mark] of [
    ['formatBold', 'strong'],
    ['formatItalic', 'em'],
    ['formatStrikeThrough', 'del'],
  ] as const) {
    if (marks.includes(mark)) commands.set(type, (state) => toggleMark(state, mark));
  }

  let typedIn: readonly number[] | undefined;
  let composedIn: readonly number[] | undefined;
  let compositions = 0;
  let plain = false;

  const viaModel = (event: InputEvent, command: RichTextCommand<C>): void => {
    if (!event.cancelable) return;
    event.preventDefault();
    host.transact(command);
  };

  const targetRange = (event: InputEvent): { from: Pos; to: Pos } | undefined => {
    const [range] = event.getTargetRanges();
    const from = range && view.posOf(range.startContainer, range.startOffset);
    const to = range && view.posOf(range.endContainer, range.endOffset);
    return from && to ? { from, to } : undefined;
  };

  const onInsertText = (event: InputEvent): void => {
    const data = event.data ?? event.dataTransfer?.getData('text/plain') ?? '';
    const state = host.read();
    const shortcut = data === ' ' ? markdownShortcut(state, options) : undefined;
    if (!shortcut && typesNatively(state, data)) {
      typedIn = state.selection.head.path;
      return;
    }
    viaModel(event, (current) => shortcut ?? insertText(current, data));
  };

  const onReplace = (event: InputEvent): void => {
    const range = targetRange(event) ?? selectionRange(host.read().selection);
    if (samePath(range.from.path, range.to.path)) {
      typedIn = range.from.path;
      return;
    }
    const data = event.dataTransfer?.getData('text/plain') || event.data || '';
    viaModel(event, (state) => replaceText(state, range.from, range.to, data));
  };

  const onDelete = (event: InputEvent): void => {
    const state = host.read();
    const { selection, doc } = state;
    const { head } = selection;
    if (isCollapsed(selection)) {
      if (event.inputType.endsWith('Backward') && head.offset === 0) {
        return viaModel(event, deleteBackward);
      }
      if (
        event.inputType.endsWith('Forward') &&
        head.offset === leafText(leafAt(doc, head.path)!).length
      ) {
        return viaModel(event, deleteForward);
      }
    } else if (!samePath(selection.anchor.path, head.path)) {
      return viaModel(event, deleteSelection);
    }
    const range = targetRange(event);
    if (range && !samePath(range.from.path, range.to.path)) {
      return viaModel(event, (current) => replaceText(current, range.from, range.to, ''));
    }
    typedIn = head.path;
  };

  const onBeforeInput = (event: InputEvent): void => {
    if (host.disabled() || host.composing || event.isComposing) return;
    const type = event.inputType;
    if (type === 'insertText') return onInsertText(event);
    if (NATIVE.has(type)) return onReplace(event);
    if (type.startsWith('delete') && type !== 'deleteByDrag' && type !== 'deleteByCut') {
      return onDelete(event);
    }
    event.preventDefault();
    const command = commands.get(type);
    if (command) host.transact(command);
  };

  const resync = (): void => {
    const offset = textOffset();
    const read = htmlToRichText<C>(surface, { link: (anchor) => view.linkOf(anchor), pre: true });
    const { doc } = createRichTextState(clip(read));
    view.reset();
    host.accept({ doc, selection: caret(posAtTextOffset(doc, offset)) });
  };

  const readBack = (path: readonly number[] | undefined): void => {
    if (!view.intact()) return resync();
    const selection = view.readSelection();
    const at = path ?? selection?.head.path;
    if (!at) return;
    const state = host.state();
    const leaf = leafAt(state.doc, at);
    const element = view.leafElement(at);
    if (!leaf || !element) return resync();
    const before = leafText(leaf);
    const after = domText<Node>(element);
    const typed = selection && samePath(selection.head.path, at) ? selection.head.offset : 0;
    const { from, to, text } = diffText(before, after, typed);
    const edited =
      before === after
        ? state
        : replaceText(state, { path: at, offset: from }, { path: at, offset: to }, text);
    host.accept({ ...edited, selection: selection ?? edited.selection }, leafAt(edited.doc, at));
  };

  const textOffset = (): number => {
    const selection = ownerDocument.getSelection();
    if (!selection?.focusNode || !surface.contains(selection.focusNode)) return 0;
    const range = ownerDocument.createRange();
    range.setStart(surface, 0);
    range.setEnd(selection.focusNode, selection.focusOffset);
    return range.toString().length;
  };

  const clip = (value: RichText<C>): RichText<C> =>
    normalizeRichText(conformRichText(value, options), options);

  const anchorLink = (anchor: NodeLike): Link<C> | undefined => {
    const href = anchor.getAttribute?.('href')?.trim();
    return href ? host.record?.(href) : undefined;
  };

  const richData = (data: DataTransfer): RichText<C> => {
    const json = data.getData(FLAVOR);
    const parsed =
      json && jsonDepthWithin(json, MAX_JSON_DEPTH) ? jsonDeserialize(json) : undefined;
    if (isRichText(parsed)) return clip(parsed as RichText<C>);
    const html = data.getData('text/html');
    if (!html || html.length > MAX_HTML) return [];
    const body = new DOMParser().parseFromString(html, 'text/html').body;
    return clip(htmlToRichText<C>(body, { link: anchorLink }));
  };

  const loneLink = (text: string): Link<C> | undefined => {
    const url = text.trim();
    const { links = true } = options;
    if (links === false || !LONE_URL.test(url)) return undefined;
    const link: Link<C> = host.record?.(url) ?? { url };
    return checkLink(link, links).length === 0 ? link : undefined;
  };

  const pasted = (data: DataTransfer, plainOnly: boolean): RichTextCommand<C> | undefined => {
    const rich = plainOnly ? [] : richData(data);
    if (rich.length > 0) return (state) => insertSlice(state, rich);
    const text = data.getData('text/plain');
    const link = plainOnly ? undefined : loneLink(text);
    if (link) {
      const label = (isRecordLink(link) && host.label?.(link)) || text.trim();
      const slice: RichText<C> = [{ kind: 'paragraph', content: [{ text: label, link }] }];
      return (state) =>
        isCollapsed(state.selection) ? insertSlice(state, slice) : setLink(state, link);
    }
    const slice = clip(textToRichText(text));
    return slice.length > 0 ? (state) => insertSlice(state, slice) : undefined;
  };

  const copy = (data: DataTransfer | null): boolean => {
    const selection = view.readSelection();
    if (!data || !selection || isCollapsed(selection)) return false;
    const slice = sliceRichText(host.state().doc, selection);
    data.setData('text/plain', richTextToText(slice));
    data.setData('text/html', richTextToHTML(slice));
    data.setData(FLAVOR, JSON.stringify(slice));
    return true;
  };

  const keys = richTextKeys(options, {
    toggleMark: (mark) => void host.transact((state) => toggleMark(state, mark)),
    link: () => host.link(),
    clearMarks: () => void host.transact(clearMarks),
    setBlockType: (type) => void host.transact((state) => setBlockType(state, type)),
    toggleList: (ordered) => void host.transact((state) => toggleList(state, ordered)),
    sinkItem: () => host.transact(sinkItem),
    liftItem: () => host.transact(liftItem),
    pastePlain: () => {
      plain = true;
      return false;
    },
    focusToolbar: () => host.focusToolbar(),
  });

  surface.addEventListener('beforeinput', onBeforeInput);

  surface.addEventListener('input', (event) => {
    if (host.composing || (event as InputEvent).isComposing) return;
    readBack(typedIn);
    typedIn = undefined;
  });

  surface.addEventListener('compositionstart', () => {
    compositions++;
    host.composing = true;
    composedIn ??= view.readSelection()?.head.path;
    surface.classList.add(COMPOSING);
  });

  surface.addEventListener('compositionend', () => {
    const ended = compositions;
    // Safari fires `compositionend` before its last DOM change.
    setTimeout(() => {
      if (ended !== compositions) return;
      host.composing = false;
      surface.classList.remove(COMPOSING);
      readBack(composedIn);
      composedIn = undefined;
    });
  });

  surface.addEventListener('keydown', (event) => {
    plain = false;
    if (!host.disabled() && keys(event)) event.preventDefault();
  });

  surface.addEventListener('click', (event) => {
    const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (host.disabled() || !(event.metaKey || event.ctrlKey) || !anchor) return;
    event.preventDefault();
    window.open(anchor.getAttribute('href')!, '_blank', 'noopener,noreferrer');
  });

  surface.addEventListener('copy', (event) => {
    event.preventDefault();
    copy(event.clipboardData);
  });

  surface.addEventListener('cut', (event) => {
    event.preventDefault();
    if (!host.disabled() && copy(event.clipboardData)) host.transact(deleteSelection);
  });

  surface.addEventListener('paste', (event) => {
    event.preventDefault();
    const plainOnly = plain;
    plain = false;
    const command = event.clipboardData && pasted(event.clipboardData, plainOnly);
    if (!host.disabled() && command) host.transact(command);
  });

  surface.addEventListener('dragstart', (event) => event.preventDefault());

  surface.addEventListener('drop', (event) => {
    event.preventDefault();
    const pos = view.posFromPoint(event.clientX, event.clientY);
    const command = event.dataTransfer && pasted(event.dataTransfer, false);
    if (host.disabled() || !pos || !command) return;
    surface.focus();
    host.transact((state) => command({ doc: state.doc, selection: caret(pos) }));
  });
}

/**
 * Whether the browser can type `data` over the selection exactly as the model would.
 * That holds strictly inside one run, or at the end of a leaf whose last run has no link.
 * Stored marks, a line break, or a selection across runs need the model.
 */
function typesNatively(state: RichTextState, data: string): boolean {
  if (state.storedMarks || data.includes('\n')) return false;
  const { from, to } = selectionRange(state.selection);
  if (!samePath(from.path, to.path)) return false;
  const runs = leafAt(state.doc, from.path)?.content ?? [];
  let start = 0;
  for (const run of runs) {
    const end = start + run.text.length;
    const inside =
      from.offset === to.offset
        ? start < from.offset && to.offset < end
        : start <= from.offset && to.offset <= end;
    if (inside) return true;
    start = end;
  }
  return from.offset === start && to.offset === start && !last(runs)?.link;
}

/**
 * The runs between two offsets, cut at both ends.
 */
function cutRuns<C extends string>(
  runs: readonly RichTextRun<C>[],
  start: number,
  end: number,
): RichTextRun<C>[] {
  let at = 0;
  return runs.flatMap((run) => {
    const from = at;
    at += run.text.length;
    const text = run.text.slice(Math.max(start - from, 0), Math.max(end - from, 0));
    return text ? [{ ...run, text }] : [];
  });
}

/**
 * The position after `offset` characters of the document's text, where a line break counts nothing.
 * It mirrors how a DOM `Range` counts text, which leaves out `<br>`.
 */
function posAtTextOffset(doc: RichText, offset: number): Pos {
  let left = offset;
  for (const { path, leaf } of leaves(doc)) {
    const text = leafText(leaf);
    let at = 0;
    for (; left > 0 && at < text.length; at++) if (text[at] !== '\n') left--;
    if (left === 0) return { path, offset: at };
  }
  const end = last(leaves(doc))!;
  return { path: end.path, offset: leafText(end.leaf).length };
}
