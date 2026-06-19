import type { ANSIColors } from '../../ansi/pick-ansi-colors.ts';

import { isUndefined } from '../../is/is-undefined.ts';

/**
 * A single editable line of text with a caret.
 * `value` and `cursor` are read by the renderer; the methods mutate both in place.
 * Indices count code points, so astral characters move and delete as one unit.
 */
export interface LineEditor {
  value: string;
  cursor: number;
  insert(str: string): void;
  set(value: string): void;
  charLeft(): void;
  charRight(): void;
  wordLeft(): void;
  wordRight(): void;
  lineStart(): void;
  lineEnd(): void;
  deleteCharLeft(): void;
  deleteCharRight(): void;
  deleteWordLeft(): void;
  deleteWordRight(): void;
  deleteToStart(): void;
  deleteToEnd(): void;
}

/**
 * Options for `createLineEditor`.
 */
export interface LineEditorOptions {
  /**
   * Characters that bound a word for the word-wise moves and deletes, alongside whitespace.
   * A path editor passes the separators so `ctrl+w` stops at each `/` instead of clearing the line.
   *
   * @default
   * ''
   */
  wordSeparators?: string;
}

/**
 * Creates a line editor seeded with `initial`, caret at the end.
 * Word operations skip a run of boundary characters, then a run of word characters.
 * A boundary is whitespace or any character in `wordSeparators`.
 * `set` replaces the whole line and parks the caret at the end, as after a completion.
 *
 * @example
 * ```ts
 * const line = createLineEditor('ab')
 * line.insert('c')      // value 'abc', cursor 3
 * line.charLeft()       // cursor 2
 * line.deleteCharLeft() // value 'ac', cursor 1
 * ```
 */
export function createLineEditor(initial: string, options: LineEditorOptions = {}): LineEditor {
  const separators = new Set(options.wordSeparators ?? '');
  const isStop = (char: string): boolean => isSpace(char) || separators.has(char);
  let chars = [...initial];
  let cursor = chars.length;

  const remove = (from: number, to: number): void => {
    chars.splice(from, to - from);
    cursor = from;
  };

  return {
    get value() {
      return chars.join('');
    },
    get cursor() {
      return cursor;
    },
    set cursor(at: number) {
      cursor = at;
    },
    insert(str) {
      const insert = [...str];
      chars.splice(cursor, 0, ...insert);
      cursor += insert.length;
    },
    set(value) {
      chars = [...value];
      cursor = chars.length;
    },
    charLeft() {
      cursor = Math.max(0, cursor - 1);
    },
    charRight() {
      cursor = Math.min(chars.length, cursor + 1);
    },
    wordLeft() {
      cursor = prevWord(chars, cursor, isStop);
    },
    wordRight() {
      cursor = nextWord(chars, cursor, isStop);
    },
    lineStart() {
      cursor = 0;
    },
    lineEnd() {
      cursor = chars.length;
    },
    deleteCharLeft() {
      if (cursor > 0) remove(cursor - 1, cursor);
    },
    deleteCharRight() {
      if (cursor < chars.length) remove(cursor, cursor + 1);
    },
    deleteWordLeft() {
      remove(prevWord(chars, cursor, isStop), cursor);
    },
    deleteWordRight() {
      const to = nextWord(chars, cursor, isStop);
      chars.splice(cursor, to - cursor);
    },
    deleteToStart() {
      remove(0, cursor);
    },
    deleteToEnd() {
      chars.splice(cursor, chars.length - cursor);
    },
  };
}

/**
 * Renders a line with its caret as an inverted cell, windowed to `width` columns.
 * An empty line shows `hint` dimmed, its first cell inverted; with no hint it is a lone inverted space.
 * The window slides to keep the caret in view when the line is wider than `width`.
 *
 * @example
 * ```ts
 * caretValue('ab', 1, undefined, colors, undefined) // -> 'a' + inverse 'b'
 * caretValue('', 0, 'app', colors, undefined)       // -> inverse 'a' + dim 'pp'
 * ```
 */
export function caretValue(
  value: string,
  cursor: number,
  hint: string | undefined,
  colors: ANSIColors,
  width: number | undefined,
): string {
  if (value === '') {
    if (isUndefined(hint) || hint === '') return colors.inverse(' ');
    const chars = [...hint];
    const [start, end] = caretWindow(chars.length, 0, width);
    const [first, ...rest] = chars.slice(start, end);
    if (isUndefined(first)) return colors.inverse(' ');
    return colors.inverse(first) + colors.dim(rest.join(''));
  }
  const chars = [...value];
  const [start, end] = caretWindow(chars.length, cursor, width);
  const before = chars.slice(start, cursor).join('');
  if (cursor >= end) return before + colors.inverse(' ');
  const after = chars.slice(cursor + 1, end).join('');
  return before + colors.inverse(chars[cursor]) + after;
}

/**
 * Clips `value` to `width` code points, marking the cut with a trailing ellipsis.
 * Used to fit a resolved value onto one line once the prompt is no longer active.
 *
 * @example
 * ```ts
 * clipEnd('abcdef', 4)      // -> 'abc…'
 * clipEnd('abc', undefined) // -> 'abc'
 * ```
 */
export function clipEnd(value: string, width: number | undefined): string {
  if (isUndefined(width)) return value;
  const chars = [...value];
  if (chars.length <= width) return value;
  return chars.slice(0, Math.max(0, width - 1)).join('') + '…';
}

/**
 * Reports whether `str` is a single insertable run with no control characters.
 * Filters out escape sequences and the `DEL` byte so only graphic input reaches the line.
 *
 * @example
 * ```ts
 * isPrintable('a')       // -> true
 * isPrintable('\x1b[A')  // -> false
 * isPrintable(undefined) // -> false
 * ```
 */
export function isPrintable(str: string | undefined): boolean {
  if (isUndefined(str) || str.length === 0) return false;
  for (const char of str) {
    const code = char.codePointAt(0)!;
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

function caretWindow(length: number, cursor: number, width: number | undefined): [number, number] {
  if (isUndefined(width) || length + 1 <= width) return [0, length];
  const visible = Math.max(0, width - 1);
  const end = cursor >= length ? length : cursor + 1;
  const start = Math.max(0, end - visible);
  return [start, Math.min(length, start + visible)];
}

function prevWord(chars: string[], cursor: number, isStop: (char: string) => boolean): number {
  let i = cursor;
  while (i > 0 && isStop(chars[i - 1])) i -= 1;
  while (i > 0 && !isStop(chars[i - 1])) i -= 1;
  return i;
}

function nextWord(chars: string[], cursor: number, isStop: (char: string) => boolean): number {
  let i = cursor;
  while (i < chars.length && isStop(chars[i])) i += 1;
  while (i < chars.length && !isStop(chars[i])) i += 1;
  return i;
}

function isSpace(char: string): boolean {
  return char === ' ' || char === '\t';
}
