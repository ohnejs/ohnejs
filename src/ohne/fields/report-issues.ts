import type { RichTextIssue } from '../../utils/index.ts';
import type { Message } from '../messages/known-messages.ts';

import { isUndefined } from '../../utils/index.ts';
import { validationMessage } from './validation-message.ts';

/**
 * Routes the issues a value check found into a validator's result.
 * The issue at `''` is the field's own message, returned for the validator to return.
 * Every other issue lands in `errors` at its path, as a `{ key, params }` message when it carries params.
 *
 * @example
 * ```ts
 * reportIssues([{ path: '[1].level', key: 'validation.invalidChoice' }], ctx.errors)
 * // -> undefined, with ctx.errors['[1].level'] set to 'validation.invalidChoice'
 *
 * reportIssues([{ path: '', key: 'validation.invalidValue' }], ctx.errors)
 * // -> 'validation.invalidValue'
 * ```
 */
export function reportIssues(
  issues: readonly RichTextIssue[],
  errors: Record<string, Message>,
): Message | undefined {
  let own: Message | undefined;
  for (const { path, key, params } of issues) {
    const message = isUndefined(params) ? key : validationMessage(key, params);
    if (path === '') own = message;
    else errors[path] = message;
  }
  return own;
}
