import type { FieldChoice } from '../choice/field-choice.ts';
import type { ValidationFailure } from './validation-failure.ts';

import { choiceValues } from '../choice/choice-values.ts';

/**
 * Fails a value that is none of `choices` with `validation.invalidChoice`.
 * A choice matches by its stored value, never its label.
 *
 * @example
 * ```ts
 * const choices = ['horde', { value: 'alliance', label: 'Alliance' }]
 *
 * checkChoice('horde', choices)    // -> undefined
 * checkChoice('alliance', choices) // -> undefined
 * checkChoice('Alliance', choices) // -> 'validation.invalidChoice'
 * ```
 */
export function checkChoice(
  value: string,
  choices: readonly FieldChoice<unknown>[],
): ValidationFailure | undefined {
  return choiceValues(choices).includes(value) ? undefined : 'validation.invalidChoice';
}
