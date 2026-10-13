import { checkEmail, normalizeEmail } from '../../../utils/index.ts';
import { defineField } from '../define-field.ts';
import { failureMessage } from '../validation-message.ts';

/**
 * The built-in `email` field type: an email address, stored trimmed and lowercased.
 * A query operand is compared as sent: pass it through `normalizeEmail` first.
 */
export const email = defineField({
  columnType: 'text',
  sanitizers: [normalizeEmail],
  validators: [(value) => failureMessage(checkEmail(value))],
});
