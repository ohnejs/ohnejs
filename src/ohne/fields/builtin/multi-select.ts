import type { ConditionValue, FieldChoice } from '../../../utils/index.ts';
import type { Message } from '../../messages/known-messages.ts';

import { literalUnion } from '../../../utils/codegen/index.ts';
import {
  checkChoice,
  checkCount,
  choiceValues,
  isArray,
  isEmpty,
  isString,
  isUndefined,
  uniqueArray,
} from '../../../utils/index.ts';
import { boundsProblem } from '../bounds.ts';
import { choiceListProblem, matchingChoices } from '../choice.ts';
import { defineField } from '../define-field.ts';
import { option } from '../option.ts';
import { failureMessage } from '../validation-message.ts';

/**
 * The built-in `multiSelect` field type: an ordered list of distinct string values.
 *
 * Stores a JSON list, so the `includes` operators probe its entries in a query.
 * With `choices`, every entry must come from the list and the value type is the choice union.
 * Without, any strings are legal and the value type is `string[]`.
 * Duplicate entries collapse on write, keeping the first occurrence.
 * A create that omits the field stores `[]`, unless `min` forbids it.
 * Search matches a list holding a choice whose value or label has a word starting with the token.
 * Without `choices`, it matches a list holding the token itself.
 */
export const multiSelect = defineField({
  columnType: 'json',
  jsonList: true,
  defaultValue: () => [],
  options: {
    /**
     * The values this field admits; omitted, any strings are legal.
     * A plain string is both the stored value and its display text.
     * The object form pairs the stored value with a translatable display label.
     */
    choices: option<readonly FieldChoice<Message>[]>(),

    /**
     * The fewest entries a stored list may hold.
     */
    min: option<number>(),

    /**
     * The most entries a stored list may hold.
     */
    max: option<number>(),
  },
  validateOptions: ({ options }) =>
    (isUndefined(options.choices) ? undefined : choiceListProblem(options.choices)) ??
    boundsProblem(options) ??
    choiceCountProblem(options.choices, options.min),
  emitType: (ctx) =>
    isUndefined(ctx.options.choices)
      ? 'string[]'
      : `(${literalUnion(choiceValues(ctx.options.choices))})[]`,
  sanitizers: [(value) => (isArray<string[]>(value) ? uniqueArray(value) : value)],
  validators: [
    (value) => (isArray(value) && value.every(isString) ? undefined : 'validation.invalidValue'),
    (value, ctx) => {
      const { choices } = ctx.options;
      if (isUndefined(choices)) return undefined;
      for (const [index, entry] of (value as string[]).entries()) {
        const failure = failureMessage(checkChoice(entry, choices));
        if (!isUndefined(failure)) ctx.errors[`[${index}]`] = failure;
      }
      return undefined;
    },
    (value, ctx) => failureMessage(checkCount((value as string[]).length, ctx.options)),
  ],
  search: (ctx): ConditionValue | null => {
    if (isUndefined(ctx.options.choices)) return { includes: ctx.token };
    const values = matchingChoices(ctx.options.choices, ctx.token, ctx.resolveMessage);
    return isEmpty(values) ? null : { includesAny: values };
  },
});

/**
 * What makes `min` unreachable, as error body rows, or `undefined` when a list can hold enough.
 * The values are distinct, so a list holds at most one entry per choice.
 */
function choiceCountProblem(
  choices: readonly FieldChoice<Message>[] | undefined,
  min: number | undefined,
): string[] | undefined {
  if (isUndefined(choices) || isUndefined(min) || min <= choices.length) return undefined;
  return [
    `\`min\` is \`${min}\`, above the \`${choices.length}\` choices, so no list can hold enough.`,
    'Lower `min`, or add choices.',
  ];
}
