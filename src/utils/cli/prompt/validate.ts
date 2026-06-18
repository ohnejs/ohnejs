import type { ANSIColors } from '../../ansi/pick-ansi-colors.ts';

import { applyANSIMarkup } from '../../ansi/apply-ansi-markup.ts';
import { isUndefined } from '../../is/is-undefined.ts';

/**
 * Checks a value the user is about to submit.
 * Return an error message to keep the prompt open, or `undefined` to accept the value.
 *
 * @example
 * ```ts
 * const required: Validate<string> = (value) => (value === '' ? 'Required' : undefined)
 * ```
 */
export type Validate<T> = (value: T) => string | undefined;

/**
 * Renders the rail that closes an active prompt frame.
 * Without an error it is the dim connector.
 * With one it becomes a red `└─` corner and the error, with inline markup applied like the question.
 *
 * @example
 * ```ts
 * closingRail(undefined, colors)  // -> dim '│'
 * closingRail('Required', colors) // -> red '└─ Required'
 * ```
 */
export function closingRail(error: string | undefined, colors: ANSIColors): string {
  if (isUndefined(error)) return colors.dim('│');
  return colors.red(`└─ ${applyANSIMarkup(error, true, colors)}`);
}
