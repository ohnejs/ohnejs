import { emitKeypressEvents } from 'node:readline';

import type { ANSIColors } from '../../ansi/pick-ansi-colors.ts';
import type { PromptResult } from './is-cancel.ts';

import { isUndefined } from '../../is/is-undefined.ts';
import { CANCEL } from './is-cancel.ts';

const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';

/**
 * A decoded keypress, as produced by `node:readline`.
 */
export interface Key {
  /**
   * Key name, such as `return`, `up`, or `a`.
   */
  name?: string;

  /**
   * Whether `ctrl` was held.
   */
  ctrl?: boolean;

  /**
   * Whether `meta` (`alt` or `option`) was held.
   */
  meta?: boolean;

  /**
   * Whether `shift` was held.
   */
  shift?: boolean;

  /**
   * The raw input sequence the key was decoded from.
   */
  sequence?: string;
}

/**
 * Shared input and output configuration for prompts.
 */
export interface PromptOptions {
  /**
   * Stream keypresses are read from.
   *
   * @default
   * process.stdin
   */
  input?: NodeJS.ReadableStream & { isTTY?: boolean; setRawMode?(mode: boolean): void };

  /**
   * Stream frames are written to.
   *
   * @default
   * process.stdout
   */
  output?: {
    write(text: string): void;
    isTTY?: boolean;
    columns?: number;
    on?(event: 'resize', listener: () => void): void;
    off?(event: 'resize', listener: () => void): void;
  };

  /**
   * Whether to emit ANSI styling such as the dimmed placeholder.
   * Defaults to the output stream's `isTTY`.
   */
  color?: boolean;
}

/**
 * Per-prompt render context for a flow.
 */
export interface PromptContext {
  /**
   * Styles the frame.
   */
  colors: ANSIColors;

  /**
   * Whether to draw a connecting rail above the prompt.
   */
  lead: boolean;

  /**
   * The current terminal width, when known.
   */
  columns?: number;
}

/**
 * The mutable state a prompt definition reads and updates on each keypress.
 */
export interface PromptState<T> {
  /**
   * The value the prompt resolves to on submit.
   */
  value: T;

  /**
   * `active` while the prompt runs; `submit` or `cancel` ends it.
   */
  status: 'active' | 'submit' | 'cancel';
}

/**
 * The behavior of a single prompt: its starting value, how it draws, and how it reacts to keys.
 */
export interface PromptDefinition<T> {
  /**
   * The value the prompt starts with.
   */
  initialValue: T;

  /**
   * Returns the frame for `state`, called again after every keypress and terminal resize.
   */
  render(state: PromptState<T>, context: PromptContext): string;

  /**
   * Updates `state` for a keypress; `ctrl+c` never reaches it.
   */
  onKey(key: Key, str: string | undefined, state: PromptState<T>): void;
}

/**
 * Drives a prompt to completion: raw-mode keypresses in, redrawn frames out, resolved value back.
 * `ctrl+c` cancels and resolves to `CANCEL`; otherwise the definition decides when to submit.
 */
export function runPrompt<T>(
  options: PromptOptions,
  definition: PromptDefinition<T>,
  context: PromptContext,
): Promise<PromptResult<T>> {
  const input: NonNullable<PromptOptions['input']> = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;

  return new Promise((resolve) => {
    emitKeypressEvents(input);
    if (input.isTTY) input.setRawMode?.(true);
    if (output.isTTY) output.write(HIDE_CURSOR);

    const state: PromptState<T> = { value: definition.initialValue, status: 'active' };
    let previousFrame: string | undefined;

    const draw = (): void => {
      context.columns = output.columns;
      const frame = definition.render(state, context);
      const erase = isUndefined(previousFrame)
        ? ''
        : eraseFrame(frameRows(previousFrame, output.columns));
      output.write(erase + frame);
      previousFrame = frame;
    };

    output.on?.('resize', draw);

    const onKeypress = (str: string | undefined, key: Key): void => {
      if (key.ctrl && key.name === 'c') state.status = 'cancel';
      else definition.onKey(key, str, state);
      draw();
      if (state.status === 'active') return;

      output.off?.('resize', draw);
      if (output.isTTY) output.write(SHOW_CURSOR);
      output.write('\n');
      input.off('keypress', onKeypress);
      if (input.isTTY) input.setRawMode?.(false);
      input.pause();
      resolve(state.status === 'cancel' ? CANCEL : state.value);
    };

    input.on('keypress', onKeypress);
    input.resume();
    draw();
  });
}

/**
 * Returns the escapes that move to the top of a `rowCount`-row frame and clear it, or `''` for none.
 */
function eraseFrame(rowCount: number): string {
  if (rowCount <= 0) return '';
  const up = rowCount > 1 ? `\x1b[${rowCount - 1}A` : '';
  return `${up}\r\x1b[0J`;
}

const SGR = new RegExp(`${'\x1b'}\\[[0-9;]*m`, 'g');

/**
 * Counts the terminal rows a frame occupies, wrapping each line at `columns` once styling is stripped.
 */
function frameRows(frame: string, columns: number | undefined): number {
  let rows = 0;
  for (const line of frame.split('\n')) {
    const width = [...line.replace(SGR, '')].length;
    rows += columns && columns > 0 ? Math.max(1, Math.ceil(width / columns)) : 1;
  }
  return rows;
}
