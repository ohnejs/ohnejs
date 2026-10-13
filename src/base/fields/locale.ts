import { defineField, type UncheckedMessage } from 'ohnejs';
import { canonicalizeLanguage } from 'ohnejs/utils';

import { queryLocales } from '../../ohne/query/locale.ts';

/**
 * The `locale` field type: a content locale, one of the configured `collections.locales`.
 *
 * The validator reads the set from config at write time, so the type declares no choices of its own.
 * The sanitizer canonicalizes the tag, so `de-at` stores as `de-AT`; a malformed tag stays as sent.
 * A tag outside the set rejects with `auth.unknownLocale`, naming the tag it checked.
 * Search is off until a field sets `search: true`; then a value containing the token matches.
 */
export default defineField({
  columnType: 'text',
  search: { default: false },
  sanitizers: [(value) => canonicalizeLanguage(value) ?? value],
  validators: [
    (value) => (queryLocales().locales.includes(value) ? undefined : unknownLocaleMessage(value)),
  ],
});

/**
 * The `unknownLocale` failure as its `{ key, params }` message object.
 * An app can drop the catalog that defines the key, so the cast brands it unchecked.
 */
function unknownLocaleMessage(locale: string): UncheckedMessage {
  return { key: 'auth.unknownLocale', params: { locale } } as unknown as UncheckedMessage;
}
