import type { PromptDefinition, PromptState } from './_prompt.ts';
import type { Validate } from './validate.ts';

import { isUndefined } from '../../is/is-undefined.ts';
import { createKeymap } from '../../keys/create-keymap.ts';
import { strokeFromReadlineKey } from '../../keys/stroke-from-readline-key.ts';
import { leadIn, titleLine } from './_frame.ts';
import { caretValue, clipEnd, createLineEditor, isPrintable } from './_line.ts';
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
  const editor = createLineEditor(options.initialValue ?? '');
  let error: string | undefined;
  let current: PromptState<string>;

  const submit = (): void => {
    const value =
      editor.value === '' && !isUndefined(options.defaultValue)
        ? options.defaultValue
        : editor.value;
    error = options.validate?.(value);
    if (!isUndefined(error)) return;
    current.value = value;
    current.status = 'submit';
  };
  const complete = (): void => {
    const hint = options.placeholder ?? options.defaultValue;
    if (editor.value === '' && !isUndefined(hint) && hint !== '') editor.set(hint);
  };

  const keymap = createKeymap({
    enter: submit,
    tab: complete,
    arrowleft: editor.charLeft,
    arrowright: editor.charRight,
    'ctrl+arrowleft': editor.wordLeft,
    'alt+arrowleft': editor.wordLeft,
    'ctrl+arrowright': editor.wordRight,
    'alt+arrowright': editor.wordRight,
    'alt+b': editor.wordLeft,
    'alt+f': editor.wordRight,
    home: editor.lineStart,
    'ctrl+a': editor.lineStart,
    end: editor.lineEnd,
    'ctrl+e': editor.lineEnd,
    backspace: editor.deleteCharLeft,
    'ctrl+w': editor.deleteWordLeft,
    'alt+backspace': editor.deleteWordLeft,
    'ctrl+backspace': editor.deleteWordLeft,
    delete: editor.deleteCharRight,
    'ctrl+d': editor.deleteCharRight,
    'alt+d': editor.deleteWordRight,
    'ctrl+delete': editor.deleteWordRight,
    'alt+delete': editor.deleteWordRight,
    'ctrl+u': editor.deleteToStart,
    'ctrl+k': editor.deleteToEnd,
  });

  return {
    initialValue: options.initialValue ?? '',

    render(state, { colors, lead, columns }) {
      const active = state.status === 'active';
      const rail = isUndefined(error) ? colors.dim('│') : colors.red('│');
      const hint = options.placeholder ?? options.defaultValue;
      const width = isUndefined(columns) ? undefined : Math.max(1, columns - 4);
      const value = active
        ? caretValue(state.value, editor.cursor, hint, colors, width)
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
      if (!keymap(strokeFromReadlineKey(str, key)) && isPrintable(str)) editor.insert(str!);
      if (state.status === 'active') current.value = editor.value;
    },
  };
}
