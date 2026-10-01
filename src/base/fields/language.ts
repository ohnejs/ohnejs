import { defineField, type Message, useMessages } from 'ohnejs';
import { canonicalizeLanguage } from 'ohnejs/utils';

/**
 * The `language` field type: a dashboard language, stored as its canonical BCP-47 tag.
 *
 * The sanitizer canonicalizes the tag, so `de-at` stores as `de-AT`; a malformed tag stays as sent.
 * The validator accepts a tag only when a message catalog is registered under it.
 * Any other tag rejects with `auth.unknownLanguage`, naming the tag it checked.
 * The generated value type is `GeneratedLanguage`, the union of the catalog languages.
 * Search is off until a field sets `search: true`; then a value containing the token matches.
 */
export default defineField({
  columnType: 'text',
  search: { default: false },
  emitType: (ctx) => ctx.importGenerated('messages.ts', 'GeneratedLanguage'),
  sanitizers: [(value) => canonicalizeLanguage(value) ?? value],
  validators: [(value) => (useMessages().has(value) ? undefined : unknownLanguageMessage(value))],
});

/**
 * The `unknownLanguage` failure as its `{ key, params }` message object.
 * Once `KnownMessages` has keys, the object must name one of them.
 * In this repo's typecheck only test fixtures supply those keys, so the cast bridges it.
 */
function unknownLanguageMessage(language: string): Message {
  return { key: 'auth.unknownLanguage', params: { language } } as unknown as Message;
}
