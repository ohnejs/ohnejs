import { isUndefined } from '../../../utils/index.ts';
import { defineField } from '../define-field.ts';
import { option } from '../option.ts';
import { validationMessage } from '../validation-message.ts';

/**
 * The built-in `integer` field type: a whole number within JavaScript's safe integer range.
 */
export const integer = defineField({
  columnType: 'integer',
  options: {
    /**
     * The smallest legal value.
     */
    min: option<number>(),

    /**
     * The largest legal value.
     */
    max: option<number>(),
  },
  validators: [
    (value, ctx) => {
      const { min, max } = ctx.options;
      if (!isUndefined(min) && value < min)
        return validationMessage('validation.minValue', { min });
      if (!isUndefined(max) && value > max)
        return validationMessage('validation.maxValue', { max });
      return undefined;
    },
  ],
});
