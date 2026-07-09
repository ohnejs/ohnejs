import { defineField } from '../define-field.ts';

/**
 * The built-in `boolean` field type: a true or false value.
 */
export const boolean = defineField({ columnType: 'boolean' });
