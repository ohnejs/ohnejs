import { defineField } from '../define-field.ts';
import { option } from '../option.ts';

/**
 * The built-in `text` field type: a text value.
 *
 * Non-empty by default: it rejects `''` unless `allowEmpty` is set.
 */
export const text = defineField({
  columnType: 'text',
  options: {
    /**
     * Whether an empty string is a legal value.
     * A text field rejects `''` unless this is set, so it is non-empty by default.
     *
     * @default
     * false
     */
    allowEmpty: option({ default: false }),
  },
  validators: [
    (value, ctx) => (ctx.options.allowEmpty || value !== '' ? undefined : 'validation.emptyValue'),
  ],
});
