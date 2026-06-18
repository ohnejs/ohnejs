import type { PromptContext, PromptOptions } from './_prompt.ts';
import type { PromptResult } from './is-cancel.ts';
import type { TextOptions } from './text.ts';

import { isColorStream } from '../../ansi/is-color-stream.ts';
import { pickANSIColors } from '../../ansi/pick-ansi-colors.ts';
import { runPrompt } from './_prompt.ts';
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
  const colors = pickANSIColors(options.color ?? isColorStream(options.output ?? process.stdout));
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
  };
}
