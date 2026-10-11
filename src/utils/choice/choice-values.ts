import type { FieldChoice } from './field-choice.ts';

import { isString } from '../is/is-string.ts';

/**
 * The stored values of a choice list, labels stripped.
 *
 * @example
 * ```ts
 * choiceValues(['draft', { value: 'live', label: 'Published' }]) // -> ['draft', 'live']
 * choiceValues([])                                               // -> []
 * ```
 */
export function choiceValues(choices: readonly FieldChoice<unknown>[]): string[] {
  return choices.map((choice) => (isString(choice) ? choice : choice.value));
}
