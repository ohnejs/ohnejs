import { isISOTime, isString, isUndefined } from '../../../utils/index.ts';
import { defineField } from '../define-field.ts';
import { option } from '../option.ts';
import { validationMessage } from '../validation-message.ts';

const CLOCK_PREFIX = /^\d{2}:(?:\d{2}(?::\d{2})?)?$/;

/**
 * The built-in `time` field type: a time of day, stored as `HH:MM:SS` text.
 *
 * A wall-clock time carries no date and no timezone.
 * `HH:MM` input is accepted and stored with `:00` seconds, so every stored value compares alike.
 * The fixed-width form sorts and compares lexicographically in clock order, so range queries just work.
 * Search matches a clock prefix, `HH:` or `HH:MM`; a bare `10` is too vague to match.
 */
export const time = defineField({
  columnType: 'text',
  options: {
    /**
     * The earliest legal time, as `HH:MM:SS` or `HH:MM`.
     */
    min: option<string>(),

    /**
     * The latest legal time, as `HH:MM:SS` or `HH:MM`.
     */
    max: option<string>(),
  },
  sanitizers: [(value) => (isString(value) && isISOTime(value) ? padTime(value) : value)],
  validators: [
    (value) => (isISOTime(value) ? undefined : 'validation.invalidTime'),
    (value, ctx) => {
      const { min, max } = ctx.options;
      if (!isUndefined(min) && value < padTime(min)) {
        return validationMessage('validation.minValue', { min });
      }
      if (!isUndefined(max) && value > padTime(max)) {
        return validationMessage('validation.maxValue', { max });
      }
      return undefined;
    },
  ],
  search: ({ token }) => (CLOCK_PREFIX.test(token) ? { startsWith: token } : null),
});

/**
 * A time widened to its stored `HH:MM:SS` form, so comparisons never mix widths.
 */
function padTime(value: string): string {
  return value.length === 5 ? `${value}:00` : value;
}
