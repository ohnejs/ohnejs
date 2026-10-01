import { defineField } from 'ohnejs';
import { isEmpty } from 'ohnejs/utils';

import { validationMessage } from '../../ohne/fields/validation-message.ts';

/**
 * The most characters a pattern may hold.
 */
const MAX_LENGTH = 64;

/**
 * The `datePattern` field type: a date or time format pattern, like `YYYY-MM-DD` or `HH:mm:ss`.
 *
 * The dashboard renders instants through the pattern's tokens; an unknown letter prints as itself.
 * A blank value rejects with `validation.emptyValue`, one over 64 characters with `validation.maxLength`.
 * Search is off until a field sets `search: true`; then a value containing the token matches.
 */
export default defineField({
  columnType: 'text',
  search: { default: false },
  validators: [
    (value) => (isEmpty(value, { trim: true }) ? 'validation.emptyValue' : undefined),
    (value) =>
      value.length > MAX_LENGTH
        ? validationMessage('validation.maxLength', { max: MAX_LENGTH })
        : undefined,
  ],
});
