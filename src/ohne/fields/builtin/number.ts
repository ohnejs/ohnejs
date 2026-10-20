import { checkRange, checkStep, isDecimalString, isRealNumber } from '../../../utils/index.ts';
import { boundsProblem } from '../bounds.ts';
import { defineField } from '../define-field.ts';
import { numericOptions, numericOptionsProblem } from '../numeric.ts';
import { failureMessage } from '../validation-message.ts';

/**
 * The built-in `number` field type: a finite IEEE 754 double, exactly what a JS number holds.
 * `NaN` and the infinities fail the base-type gate; every accepted value stores bit-exact.
 * Never money: a decimal tenth has no exact binary form - use `integer` minor units instead.
 * Search is off until a field sets `search: true`; then a numeric token matches the equal value.
 */
export const number = defineField({
  columnType: 'real',
  options: numericOptions,
  validateOptions: ({ options }) =>
    boundsProblem(options) ?? numericOptionsProblem(options, { whole: false }),
  validators: [
    (value, ctx) => failureMessage(checkRange(value, ctx.options) ?? checkStep(value, ctx.options)),
  ],
  search: {
    default: false,
    match: ({ token }) => {
      const number = token.replace(',', '.');
      return isDecimalString(number) && isRealNumber(Number(number))
        ? { equalsTo: Number(number) }
        : null;
    },
  },
});
