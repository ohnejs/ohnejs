import { isString, isUndefined } from '../../../utils/index.ts';
import { defineField } from '../define-field.ts';
import { option } from '../option.ts';
import { validationMessage } from '../validation-message.ts';

/**
 * The built-in `dateTime` field type: an instant, stored as epoch milliseconds.
 *
 * The same representation `_updatedAt` uses, so instants compare and sort as plain integers.
 * Writes take the integer alone.
 * The dashboard renders it in the viewer's time zone setting, unless `timezone` pins one.
 */
export const dateTime = defineField({
  columnType: 'integer',
  options: {
    /**
     * The earliest legal instant: epoch milliseconds, or an ISO 8601 string.
     */
    min: option<number | string>(),

    /**
     * The latest legal instant: epoch milliseconds, or an ISO 8601 string.
     */
    max: option<number | string>(),

    /**
     * Shows the instant as elapsed time, like "2 hours ago", with the exact date as the tooltip.
     * Omitted, the cell shows the exact date and the elapsed time as the tooltip.
     *
     * @default
     * false
     */
    relativeTime: option({ default: false }),

    /**
     * The IANA time zone the dashboard displays and edits the instant in, like `Europe/Berlin`.
     * Omitted, the viewer's own time zone setting applies.
     */
    timezone: option<string>(),
  },
  validators: [
    (value, ctx) => {
      const { min, max } = ctx.options;
      if (!isUndefined(min) && value < instant(min)) {
        return validationMessage('validation.minValue', { min });
      }
      if (!isUndefined(max) && value > instant(max)) {
        return validationMessage('validation.maxValue', { max });
      }
      return undefined;
    },
  ],
});

/**
 * A declared bound as epoch milliseconds, parsing the ISO form.
 */
function instant(bound: number | string): number {
  return isString(bound) ? Date.parse(bound) : bound;
}
