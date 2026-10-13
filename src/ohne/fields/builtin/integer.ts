import { checkRange, isInteger } from '../../../utils/index.ts';
import { boundsProblem } from '../bounds.ts';
import { defineField } from '../define-field.ts';
import { option } from '../option.ts';
import { failureMessage } from '../validation-message.ts';

/**
 * The built-in `integer` field type: a whole number within JavaScript's safe integer range.
 * Search is off until a field sets `search: true`; then an integer token matches the equal value.
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
  validateOptions: ({ options }) => boundsProblem(options),
  validators: [(value, ctx) => failureMessage(checkRange(value, ctx.options))],
  search: {
    default: false,
    match: ({ token }) =>
      /^[+-]?\d+$/.test(token) && isInteger(Number(token)) ? { equalsTo: Number(token) } : null,
  },
});
