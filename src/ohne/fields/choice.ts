import type { FieldChoice } from '../../utils/index.ts';
import type { Message } from '../messages/known-messages.ts';

import {
  choiceValues,
  duplicates,
  isEmpty,
  isString,
  matchesWordStart,
} from '../../utils/index.ts';

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

/**
 * Checks a declared choice list, for a field type's `validateOptions`.
 * Returns the problem as error body rows, or `undefined` when the list holds.
 * An empty list admits no value, and a repeated value makes two choices indistinguishable once stored.
 */
export function choiceListProblem(choices: readonly FieldChoice<Message>[]): string[] | undefined {
  if (isEmpty(choices)) {
    return ['`choices` is empty, so no value can be chosen.', 'List at least one choice.'];
  }
  const repeated = duplicates(choiceValues(choices));
  if (isEmpty(repeated)) return undefined;
  return [
    '`choices` repeats a value, so its choices cannot be told apart once stored.',
    'Drop the duplicates:',
    '',
    ...repeated.map((value) => `- \`${value}\``),
  ];
}
