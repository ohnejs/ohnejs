import type { ANSIColors } from '../../ansi/pick-ansi-colors.ts';
import type { PromptDefinition, PromptState } from './_prompt.ts';
import type { Validate } from './validate.ts';

import { isUndefined } from '../../is/is-undefined.ts';
import { createKeymap } from '../../keys/create-keymap.ts';
import { strokeFromReadlineKey } from '../../keys/stroke-from-readline-key.ts';
import { leadIn, titleLine } from './_frame.ts';
import { closingRail } from './validate.ts';

/**
 * Options for a text prompt.
 */
export interface TextOptions {
  /**
   * The question shown above the input.
   */
  message: string;

  /**
   * Value the input starts with, editable by the user.
   *
   * @default
   * ''
   */
  initialValue?: string;

  /**
   * Value used when the user submits an empty input.
   */
  defaultValue?: string;

  /**
   * Dimmed hint shown while the input is empty.
   * When unset, `defaultValue` is shown as the hint instead.
   */
  placeholder?: string;

  /**
   * Rejects a value the user tries to submit.
   * Runs against the effective value, with `defaultValue` already applied.
   */
  validate?: Validate<string>;
}

/**
 * Builds the definition for a single-line text prompt.
 * Printable keys insert at the cursor; arrows move it, with `ctrl`/`alt` jumping by word.
 *
 * - `home`/`end` (or `ctrl+a`/`ctrl+e`) jump to the ends of the line.
 * - `backspace` and `delete` remove a character; held with `ctrl`/`alt` (or `ctrl+w`) they remove a word.
 * - `ctrl+u` clears to the line start and `ctrl+k` to the line end.
 * - `tab` fills an empty input with the placeholder, and `enter` submits, both fall back to `defaultValue`.
 */
export function textDefinition(options: TextOptions): PromptDefinition<string> {
  let cursor = [...(options.initialValue ?? '')].length;
  let error: string | undefined;
  let current: PromptState<string>;

  const length = (): number => [...current.value].length;
  const edit = (chars: string[], at: number): void => {
    current.value = chars.join('');
    cursor = at;
  };

  const submit = (): void => {
    const value =
      current.value === '' && !isUndefined(options.defaultValue)
        ? options.defaultValue
        : current.value;
    error = options.validate?.(value);
    if (!isUndefined(error)) return;
    current.value = value;
    current.status = 'submit';
  };
  const complete = (): void => {
    const hint = options.placeholder ?? options.defaultValue;
    if (current.value === '' && !isUndefined(hint) && hint !== '')
      edit([...hint], [...hint].length);
  };

  const wordLeft = (): void => void (cursor = prevWord([...current.value], cursor));
  const wordRight = (): void => void (cursor = nextWord([...current.value], cursor));
  const charLeft = (): void => void (cursor = Math.max(0, cursor - 1));
  const charRight = (): void => void (cursor = Math.min(length(), cursor + 1));
  const lineStart = (): void => void (cursor = 0);
  const lineEnd = (): void => void (cursor = length());

  const deleteRange = (from: number, to: number): void => {
    const chars = [...current.value];
    chars.splice(from, to - from);
    edit(chars, from);
  };
  const deleteWordLeft = (): void => deleteRange(prevWord([...current.value], cursor), cursor);
  const deleteWordRight = (): void => deleteRange(cursor, nextWord([...current.value], cursor));
  const deleteToStart = (): void => deleteRange(0, cursor);
  const deleteToEnd = (): void => deleteRange(cursor, length());
  const deleteCharLeft = (): void => {
    if (cursor > 0) deleteRange(cursor - 1, cursor);
  };
  const deleteCharRight = (): void => {
    if (cursor < length()) deleteRange(cursor, cursor + 1);
  };

  const keymap = createKeymap({
    enter: submit,
    tab: complete,
    arrowleft: charLeft,
    arrowright: charRight,
    'ctrl+arrowleft': wordLeft,
    'alt+arrowleft': wordLeft,
    'ctrl+arrowright': wordRight,
    'alt+arrowright': wordRight,
    'alt+b': wordLeft,
    'alt+f': wordRight,
    home: lineStart,
    'ctrl+a': lineStart,
    end: lineEnd,
    'ctrl+e': lineEnd,
    backspace: deleteCharLeft,
    'ctrl+w': deleteWordLeft,
    'alt+backspace': deleteWordLeft,
    'ctrl+backspace': deleteWordLeft,
    delete: deleteCharRight,
    'ctrl+d': deleteCharRight,
    'alt+d': deleteWordRight,
    'ctrl+delete': deleteWordRight,
    'alt+delete': deleteWordRight,
    'ctrl+u': deleteToStart,
    'ctrl+k': deleteToEnd,
  });

  return {
    initialValue: options.initialValue ?? '',

    render(state, { colors, lead, columns }) {
      const active = state.status === 'active';
      const rail = isUndefined(error) ? colors.dim('│') : colors.red('│');
      const hint = options.placeholder ?? options.defaultValue;
      const width = isUndefined(columns) ? undefined : Math.max(1, columns - 4);
      const value = active
        ? caretValue(state.value, cursor, hint, colors, width)
        : colors.dim(clipEnd(state.value, width));

      const valueLine = `${rail}  ${value}`;
      const close = closingRail(error, colors);
      const body = active ? `${rail}\n${valueLine}\n${close}` : valueLine;
      const block = `${titleLine(options.message, state.status, error, colors)}\n${body}`;
      return leadIn(block, lead, colors);
    },

    onKey(key, str, state) {
      current = state;
      error = undefined;
      if (keymap(strokeFromReadlineKey(str, key))) return;
      if (isPrintable(str)) {
        const chars = [...state.value];
        const insert = [...str!];
        chars.splice(cursor, 0, ...insert);
        edit(chars, cursor + insert.length);
      }
    },
  };
}

function caretValue(
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

function caretWindow(length: number, cursor: number, width: number | undefined): [number, number] {
  if (isUndefined(width) || length + 1 <= width) return [0, length];
  const visible = Math.max(0, width - 1);
  const end = cursor >= length ? length : cursor + 1;
  const start = Math.max(0, end - visible);
  return [start, Math.min(length, start + visible)];
}

function clipEnd(value: string, width: number | undefined): string {
  if (isUndefined(width)) return value;
  const chars = [...value];
  if (chars.length <= width) return value;
  return chars.slice(0, Math.max(0, width - 1)).join('') + '…';
}

function prevWord(chars: string[], cursor: number): number {
  let i = cursor;
  while (i > 0 && isSpace(chars[i - 1])) i -= 1;
  while (i > 0 && !isSpace(chars[i - 1])) i -= 1;
  return i;
}

function nextWord(chars: string[], cursor: number): number {
  let i = cursor;
  while (i < chars.length && isSpace(chars[i])) i += 1;
  while (i < chars.length && !isSpace(chars[i])) i += 1;
  return i;
}

function isSpace(char: string): boolean {
  return char === ' ' || char === '\t';
}

function isPrintable(str: string | undefined): boolean {
  if (isUndefined(str) || str.length === 0) return false;
  for (const char of str) {
    const code = char.codePointAt(0)!;
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}
