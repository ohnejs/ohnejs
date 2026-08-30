import type { Message } from '../messages/known-messages.ts';

import { isString } from '../../utils/index.ts';

/**
 * A choice value paired with its display label.
 */
export interface LabeledChoice {
  /**
   * The stored value.
   */
  value: string;

  /**
   * The label the dashboard shows for the value.
   * Pass a message key to translate it per the viewer's language.
   * A `{ key, params }` object supplies a parameterized message; a plain string is shown as-is.
   */
  label: Message;
}

/**
 * One choice a `select` or `multiSelect` field admits.
 * A plain string is both the stored value and its display text.
 * The object form pairs the stored value with a translatable display label.
 */
export type FieldChoice = string | LabeledChoice;

/**
 * The stored values of a choice list, labels stripped.
 *
 * @example
 * ```ts
 * choiceValues(['draft', { value: 'live', label: 'Published' }]) // -> ['draft', 'live']
 * ```
 */
export function choiceValues(choices: readonly FieldChoice[]): string[] {
  return choices.map((choice) => (isString(choice) ? choice : choice.value));
}
