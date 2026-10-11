import type { FieldChoice } from '../../utils/index.ts';
import type { Message } from '../messages/known-messages.ts';

import { choiceValues, isString, matchesWordStart } from '../../utils/index.ts';

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
  choices: readonly FieldChoice<Message>[],
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
