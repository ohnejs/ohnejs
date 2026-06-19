import type { PromptContext, PromptOptions } from './_prompt.ts';
import type { ConfirmOptions } from './confirm.ts';
import type { PromptResult } from './is-cancel.ts';
import type { MultiselectOptions } from './multiselect.ts';
import type { PathOptions } from './path.ts';
import type { SelectOptions } from './select.ts';
import type { Spinner, SpinnerOptions } from './spinner.ts';
import type { TextOptions } from './text.ts';

import { isColorStream } from '../../ansi/is-color-stream.ts';
import { pickANSIColors } from '../../ansi/pick-ansi-colors.ts';
import { runPrompt } from './_prompt.ts';
import { confirmDefinition } from './confirm.ts';
import { introLine, noteBlock, outroBlock } from './flow.ts';
import { multiselectDefinition } from './multiselect.ts';
import { pathDefinition } from './path.ts';
import { selectDefinition } from './select.ts';
import { createSpinner } from './spinner.ts';
import { textDefinition } from './text.ts';

/**
 * A bound set of interactive prompts that share one input and output.
 */
export interface Prompt {
  /**
   * Asks for a single line of text.
   * Resolves to the entered string, or `CANCEL` if the user cancels.
   */
  text(options: TextOptions): Promise<PromptResult<string>>;

  /**
   * Asks for a filesystem path, completing folders as you type.
   * Resolves to the chosen path, or `CANCEL` if the user cancels.
   */
  path(options: PathOptions): Promise<PromptResult<string>>;

  /**
   * Asks a yes/no question.
   * Resolves to the chosen boolean, or `CANCEL` if the user cancels.
   */
  confirm(options: ConfirmOptions): Promise<PromptResult<boolean>>;

  /**
   * Asks for one choice from a list.
   * Resolves to the chosen option's value, or `CANCEL` if the user cancels.
   */
  select<T>(options: SelectOptions<T>): Promise<PromptResult<T>>;

  /**
   * Asks for any number of choices from a list.
   * Resolves to the checked options' values in display order, or `CANCEL` if the user cancels.
   */
  multiselect<T>(options: MultiselectOptions<T>): Promise<PromptResult<T[]>>;

  /**
   * Creates a progress spinner bound to the same stream, joined to a prior prompt by the rail.
   * Drive it with `start`, `message`, and `stop`.
   */
  spinner(options?: Pick<SpinnerOptions, 'frames' | 'interval'>): Spinner;

  /**
   * Opens a flow with a top corner and a title.
   * Prompts that follow connect to it by the rail.
   */
  intro(message?: string): void;

  /**
   * Closes a flow with a bottom corner and a parting message.
   */
  outro(message?: string): void;

  /**
   * Prints a boxed aside off the rail, for information shown between prompts.
   */
  note(message: string, title?: string, last?: boolean): void;
}

/**
 * Creates a `Prompt` bound to the given streams.
 *
 * @example
 * ```ts
 * const prompt = createPrompt()
 * const name = await prompt.text({ message: 'Project name?', defaultValue: 'app' })
 * ```
 */
export function createPrompt(options: PromptOptions = {}): Prompt {
  const output = options.output ?? process.stdout;
  const color = options.color ?? isColorStream(output);
  const colors = pickANSIColors(color);
  let started = false;

  const context = (): PromptContext => {
    const lead = started;
    started = true;
    return { colors, lead };
  };

  return {
    text(textOptions) {
      return runPrompt(options, textDefinition(textOptions), context());
    },
    path(pathOptions) {
      return runPrompt(options, pathDefinition(pathOptions), context());
    },
    confirm(confirmOptions) {
      return runPrompt(options, confirmDefinition(confirmOptions), context());
    },
    select(selectOptions) {
      return runPrompt(options, selectDefinition(selectOptions), context());
    },
    multiselect(multiselectOptions) {
      return runPrompt(options, multiselectDefinition(multiselectOptions), context());
    },
    spinner(spinnerOptions = {}) {
      return createSpinner({
        ...spinnerOptions,
        input: options.input,
        output,
        color,
        lead: context().lead,
      });
    },
    intro(message = '') {
      output.write(`${introLine(message, colors, context().lead)}\n`);
    },
    outro(message = '') {
      output.write(`${outroBlock(message, colors, context().lead)}\n`);
    },
    note(message, title = '', last = false) {
      output.write(`${noteBlock(message, title, colors, context().lead, last)}\n`);
    },
  };
}
