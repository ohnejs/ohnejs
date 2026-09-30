import { isArray } from '../../utils/is/is-array.ts';
import { isString } from '../../utils/is/is-string.ts';

/**
 * Instructions for the assistant: one text, or a list of lines joined with line breaks.
 * Lines keep a long prompt readable in code, and a backtick needs no escaping in a quoted line.
 *
 * @example
 * ```ts
 * prompt: 'Answer from Characters.'
 *
 * prompt: [
 *   'Find the items that lack the target locale.',
 *   'Rewrite `name` and `tooltip` into it.',
 * ]
 * ```
 */
export type Prompt = string | readonly string[];

/**
 * The prompt as one text, its lines joined with line breaks and the whole trimmed.
 *
 * @example
 * ```ts
 * promptText('  Answer briefly. ')           // -> 'Answer briefly.'
 * promptText(['Read first.', 'Then write.']) // -> 'Read first.\nThen write.'
 * ```
 */
export function promptText(prompt: Prompt): string {
  return (isString(prompt) ? prompt : prompt.join('\n')).trim();
}

/**
 * Whether a value is a prompt with some text: a non-blank string, or a list of strings that is not blank.
 *
 * @example
 * ```ts
 * isPrompt('Answer briefly.')   // -> true
 * isPrompt(['', 'Read first.']) // -> true
 * isPrompt(['', ' '])           // -> false
 * isPrompt(42)                  // -> false
 * ```
 */
export function isPrompt(value: unknown): value is Prompt {
  if (isArray(value)) return value.every(isString) && promptText(value) !== '';
  return isString(value) && value.trim() !== '';
}
