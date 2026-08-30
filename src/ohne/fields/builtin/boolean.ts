import { defineField } from '../define-field.ts';
import { option } from '../option.ts';

/**
 * The built-in `boolean` field type: a true or false value.
 */
export const boolean = defineField({
  columnType: 'boolean',
  options: {
    /**
     * The control the dashboard edits the value with.
     * Presentation only: the stored value is a plain boolean either way.
     *
     * @default
     * 'checkbox'
     */
    display: option<'checkbox' | 'switch'>({ default: 'checkbox' }),
  },
});
