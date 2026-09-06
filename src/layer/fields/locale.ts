import { defineField, type Message } from 'ohne';

import { queryLocales } from '../../ohne/query/locale.ts';

/**
 * The `locale` field type: a content locale, one of the configured `collections.locales`.
 *
 * The validator reads the set from config at write time, so the type declares no choices of its own.
 * A tag outside the set rejects with `auth.unknownLocale`, naming the submitted value.
 * The set holds canonical tags, so the value must arrive canonical, like `de-AT`.
 */
export default defineField({
  columnType: 'text',
  validators: [
    (value) => (queryLocales().locales.includes(value) ? undefined : unknownLocaleMessage(value)),
  ],
});

/**
 * The `unknownLocale` failure as its `{ key, params }` message object.
 * The key lives in the layer's own catalog, resolved at the boundary, never in `KnownMessages`.
 * Its object is therefore not a `Message` member here; the cast bridges it.
 */
function unknownLocaleMessage(locale: string): Message {
  return { key: 'auth.unknownLocale', params: { locale } } as unknown as Message;
}
