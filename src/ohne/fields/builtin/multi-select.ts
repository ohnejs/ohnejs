import type { FieldChoice } from '../choice.ts';

import { literalUnion } from '../../../utils/codegen/index.ts';
import { isArray, isString, isUndefined, uniqueArray } from '../../../utils/index.ts';
import { choiceValues } from '../choice.ts';
import { defineField } from '../define-field.ts';
import { option } from '../option.ts';
import { validationMessage } from '../validation-message.ts';

/**
 * The built-in `multiSelect` field type: an ordered list of distinct string values.
 *
 * Stores a JSON list, so the `includes` operators probe its entries in a query.
 * With `choices`, every entry must come from the list and the value type is the choice union.
 * Without, any strings are legal and the value type is `string[]`.
 * Duplicate entries collapse on write, keeping the first occurrence.
 * A create that omits the field stores `[]`.
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
    choices: option<readonly FieldChoice[]>(),

    /**
     * The fewest entries a stored list may hold.
     */
    min: option<number>(),

    /**
     * The most entries a stored list may hold.
     */
    max: option<number>(),
  },
  emitType: (ctx) =>
    isUndefined(ctx.options.choices)
      ? 'string[]'
      : `(${literalUnion(choiceValues(ctx.options.choices))})[]`,
  sanitizers: [(value) => (isArray<string[]>(value) ? uniqueArray(value) : value)],
  validators: [
    (value) => (isArray(value) && value.every(isString) ? undefined : 'validation.invalidValue'),
    (value, ctx) => {
      if (isUndefined(ctx.options.choices)) return undefined;
      const legal = choiceValues(ctx.options.choices);
      for (const [index, entry] of (value as string[]).entries()) {
        if (!legal.includes(entry)) ctx.errors[`[${index}]`] = 'validation.invalidChoice';
      }
      return undefined;
    },
    (value, ctx) => {
      const { min, max } = ctx.options;
      const count = (value as string[]).length;
      if (!isUndefined(min) && count < min)
        return validationMessage('validation.minItems', { min });
      if (!isUndefined(max) && count > max)
        return validationMessage('validation.maxItems', { max });
      return undefined;
    },
  ],
});
