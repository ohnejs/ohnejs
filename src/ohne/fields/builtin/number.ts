import { isUndefined } from '../../../utils/index.ts';
import { defineField } from '../define-field.ts';
import { option } from '../option.ts';
import { validationMessage } from '../validation-message.ts';

/**
 * The built-in `number` field type: a finite IEEE 754 double, exactly what a JS number holds.
 * `NaN` and the infinities fail the base-type gate; every accepted value stores bit-exact.
 * Never money: a decimal tenth has no exact binary form - use `integer` minor units instead.
 */
export const number = defineField({
  columnType: 'real',
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
