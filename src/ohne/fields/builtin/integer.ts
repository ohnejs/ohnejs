import { defineField } from '../define-field.ts';

/**
 * The built-in `integer` field type: a whole number within JavaScript's safe integer range.
 */
export const integer = defineField({ columnType: 'integer' });
