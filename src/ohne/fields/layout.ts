import type {
  FieldLayout as SharedFieldLayout,
  FieldLayoutNode as SharedFieldLayoutNode,
} from '../../utils/index.ts';
import type { Message } from '../messages/known-messages.ts';

import { isUndefined, layoutProblems } from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';

/**
 * How a form arranges its fields, with card and tab labels typed as messages.
 * The node grammar is the shared `FieldLayout` of `ohnejs/utils`.
 * `TField` narrows the names to the fields the host declares.
 *
 * @example
 * ```ts
 * layout: [
 *   { card: [{ row: ['firstName', 'lastName'] }, 'email | 50%'] },
 *   { tabs: [{ label: 'app.posts.seo', fields: ['slug | 40%', 'metaDescription'] }] },
 *   '---',
 *   { card: { label: 'Internal', collapsible: true, fields: ['notes', 'pinned | auto'] } },
 * ]
 * ```
 */
export type FieldLayout<TField extends string = string> = SharedFieldLayout<TField, Message>;

/**
 * One node of a `FieldLayout`, with card and tab labels typed as messages.
 */
export type FieldLayoutNode<TField extends string = string> = SharedFieldLayoutNode<
  TField,
  Message
>;

/**
 * Rejects a malformed `layout` declaration with the first problem `layoutProblems` finds.
 * `option` names the declaration in messages, like `dashboard.layout`.
 * `scope` locates it with a leading space, like `` in collection `Posts` ``; `''` when unknown.
 */
export function validateLayout(
  layout: unknown,
  fieldNames: readonly string[],
  option: string,
  scope: string,
): void {
  const [problem] = layoutProblems(layout, fieldNames, { option, scope });
  if (!isUndefined(problem)) throw ohneError(problem);
}
