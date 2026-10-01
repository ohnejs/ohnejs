import { isISODate, isUndefined } from '../../../utils/index.ts';
import { defineField } from '../define-field.ts';
import { option } from '../option.ts';
import { validationMessage } from '../validation-message.ts';

const ISO_PREFIX = /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/;

/**
 * The built-in `date` field type: a calendar day, stored as `YYYY-MM-DD` text.
 *
 * A day is not an instant, so no timezone is involved and no epoch conversion can shift it.
 * The ISO form sorts and compares lexicographically in calendar order, so range queries just work.
 * Search matches an ISO prefix, `YYYY`, `YYYY-MM`, or `YYYY-MM-DD`; any other token never matches.
 */
export const date = defineField({
  columnType: 'text',
  options: {
    /**
     * The earliest legal day, as `YYYY-MM-DD`.
     */
    min: option<string>(),

    /**
     * The latest legal day, as `YYYY-MM-DD`.
     */
    max: option<string>(),
  },
  validators: [
    (value) => (isISODate(value) ? undefined : 'validation.invalidDate'),
    (value, ctx) => {
      const { min, max } = ctx.options;
      if (!isUndefined(min) && value < min)
        return validationMessage('validation.minValue', { min });
      if (!isUndefined(max) && value > max)
        return validationMessage('validation.maxValue', { max });
      return undefined;
    },
  ],
  search: ({ token }) => (ISO_PREFIX.test(token) ? { startsWith: token } : null),
});
