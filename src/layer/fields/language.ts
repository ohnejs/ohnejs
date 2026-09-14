import { defineField, type Message, useMessages } from 'ohnejs';
import { canonicalizeLanguage } from 'ohnejs/utils';

/**
 * The `language` field type: a dashboard language, stored as its canonical BCP-47 tag.
 *
 * The sanitizer canonicalizes the tag, so `de-at` stores as `de-AT`; a malformed tag stays as sent.
 * The validator accepts a tag only when a message catalog is registered under it.
 * Any other tag rejects with `auth.unknownLanguage`, naming the tag it checked.
 * The generated value type is `GeneratedLanguage`, the union of the catalog languages.
 */
export default defineField({
  columnType: 'text',
  emitType: (ctx) => ctx.importGenerated('messages.ts', 'GeneratedLanguage'),
  sanitizers: [(value) => canonicalizeLanguage(value) ?? value],
  validators: [(value) => (useMessages().has(value) ? undefined : unknownLanguageMessage(value))],
});

/**
 * The `unknownLanguage` failure as its `{ key, params }` message object.
 * The key lives in the layer's own catalog, resolved at the boundary, never in `KnownMessages`.
 * Its object is therefore not a `Message` member here; the cast bridges it.
 */
function unknownLanguageMessage(language: string): Message {
  return { key: 'auth.unknownLanguage', params: { language } } as unknown as Message;
}
