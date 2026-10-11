import { checkRange, isDecimalString, isRealNumber } from '../../../utils/index.ts';
import { defineField } from '../define-field.ts';
import { option } from '../option.ts';
import { failureMessage } from '../validation-message.ts';

/**
 * The built-in `number` field type: a finite IEEE 754 double, exactly what a JS number holds.
 * `NaN` and the infinities fail the base-type gate; every accepted value stores bit-exact.
 * Never money: a decimal tenth has no exact binary form - use `integer` minor units instead.
 * Search is off until a field sets `search: true`; then a numeric token matches the equal value.
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
  validators: [(value, ctx) => failureMessage(checkRange(value, ctx.options))],
  search: {
    default: false,
    match: ({ token }) =>
      isDecimalString(token) && isRealNumber(Number(token)) ? { equalsTo: Number(token) } : null,
  },
});
