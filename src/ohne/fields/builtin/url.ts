import { checkURL, normalizeHTTPURL } from '../../../utils/index.ts';
import { defineField } from '../define-field.ts';
import { failureMessage } from '../validation-message.ts';

/**
 * The built-in `url` field type: an absolute `http:` or `https:` address with a public domain name.
 * It is stored with its scheme and host lowercased and a default port dropped, so `unique` compares one form.
 * For a `mailto:` or `tel:` address, a `/path` or a `#fragment`, use `link`.
 */
export const url = defineField({
  columnType: 'text',
  sanitizers: [normalizeHTTPURL],
  validators: [(value) => failureMessage(checkURL(value))],
});
