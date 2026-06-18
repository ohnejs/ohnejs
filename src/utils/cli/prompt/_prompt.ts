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
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
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
 * `colors` styles the frame and `lead` draws a connecting rail above the prompt.
 * `columns` is the current terminal width, when known.
 */
export interface PromptContext {
  colors: ANSIColors;
  lead: boolean;
  columns?: number;
}

/**
 * The mutable state a prompt definition reads and updates on each keypress.
 */
export interface PromptState<T> {
  value: T;
  status: 'active' | 'submit' | 'cancel';
}

/**
 * The behavior of a single prompt: its starting value, how it draws, and how it reacts to keys.
 */
export interface PromptDefinition<T> {
  initialValue: T;
  render(state: PromptState<T>, context: PromptContext): string;
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

function eraseFrame(rowCount: number): string {
  if (rowCount <= 0) return '';
  const up = rowCount > 1 ? `\x1b[${rowCount - 1}A` : '';
  return `${up}\r\x1b[0J`;
}

const SGR = new RegExp(`${'\x1b'}\\[[0-9;]*m`, 'g');

function frameRows(frame: string, columns: number | undefined): number {
  let rows = 0;
  for (const line of frame.split('\n')) {
    const width = [...line.replace(SGR, '')].length;
    rows += columns && columns > 0 ? Math.max(1, Math.ceil(width / columns)) : 1;
  }
  return rows;
}
