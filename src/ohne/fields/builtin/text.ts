import { isUndefined } from '../../../utils/index.ts';
import { defineField } from '../define-field.ts';
import { option } from '../option.ts';
import { validationMessage } from '../validation-message.ts';

/**
 * The built-in `text` field type: a text value.
 *
 * Non-empty by default: it rejects `''` unless `allowEmpty` is set.
 * `min` and `max` bound the length in characters, counted as UTF-16 units like `String#length`.
 */
export const text = defineField({
  columnType: 'text',
  options: {
    /**
     * Whether an empty string is a legal value.
     * A text field rejects `''` unless this is set, so it is non-empty by default.
     * A literal `default: ''` without it fails every write that omits the field.
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
  validators: [
    (value, ctx) => (ctx.options.allowEmpty || value !== '' ? undefined : 'validation.emptyValue'),
    (value, ctx) => {
      const { min, max } = ctx.options;
      if (!isUndefined(min) && value.length < min) {
        return validationMessage('validation.minLength', { min });
      }
      if (!isUndefined(max) && value.length > max) {
        return validationMessage('validation.maxLength', { max });
      }
      return undefined;
    },
  ],
});
