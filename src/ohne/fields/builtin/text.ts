import { checkText } from '../../../utils/index.ts';
import { boundsProblem } from '../bounds.ts';
import { defineField } from '../define-field.ts';
import { option } from '../option.ts';
import { failureMessage } from '../validation-message.ts';

/**
 * The built-in `text` field type: a text value.
 *
 * Non-empty by default: it rejects `''` unless `allowEmpty` is set.
 * `min` and `max` bound the length in characters, counted as UTF-16 units like `String#length`.
 * Search matches a value that contains the token, ignoring case.
 */
export const text = defineField({
  columnType: 'text',
  options: {
    /**
     * Whether an empty string is a legal value.
     * A text field rejects `''` unless this is set, so it is non-empty by default.
     * A literal `default: ''` without it is rejected at boot.
     *
     * @default
     * false
     */
    allowEmpty: option({ default: false }),

    /**
     * The fewest characters a value may hold.
     */
    min: option<number>(),

    /**
     * The most characters a value may hold.
     */
    max: option<number>(),

    /**
     * Whether the dashboard edits the value as a fixed multi-line area.
     * Presentation only: any text field accepts newlines either way.
     *
     * @default
     * false
     */
    multiline: option({ default: false }),
  },
  validateOptions: ({ options }) => boundsProblem(options),
  validators: [(value, ctx) => failureMessage(checkText(value, ctx.options))],
});
