import type { Message } from '../messages/known-messages.ts';

import { isString, matchesWordStart } from '../../utils/index.ts';

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

/**
 * The stored values of the choices whose value or label has a word starting with `token`, ignoring case.
 * A label renders through `resolveMessage`, so a message key matches in the language search runs in.
 *
 * @example
 * ```ts
 * const choices = ['draft', { value: 'live', label: 'Published' }]
 *
 * matchingChoices(choices, 'pub', String) // -> ['live']
 * matchingChoices(choices, 'dr', String)  // -> ['draft']
 * matchingChoices(choices, 'xyz', String) // -> []
 * ```
 */
export function matchingChoices(
  choices: readonly FieldChoice[],
  token: string,
  resolveMessage: (message: Message) => string,
): string[] {
  return choiceValues(
    choices.filter((choice) =>
      isString(choice)
        ? matchesWordStart(choice, token)
        : matchesWordStart(choice.value, token) ||
          matchesWordStart(resolveMessage(choice.label), token),
    ),
  );
}
