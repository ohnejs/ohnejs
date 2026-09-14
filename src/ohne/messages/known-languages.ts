/**
 * Codegen extension point for every language the app has a message catalog for.
 * Empty until codegen runs; the `messages.ts` it emits augments this with one member per language.
 * Each member is a canonical BCP-47 tag.
 *
 * `type` aliases cannot be augmented, so the overridable tags live on this interface instead.
 *
 * @example
 * ```ts
 * declare module 'ohnejs' {
 *   interface KnownLanguages {
 *     en: true
 *     'de-AT': true
 *   }
 * }
 * ```
 */
export interface KnownLanguages {}

/**
 * A language the app has a message catalog for.
 * Narrows to the generated union of tags once codegen has run; falls back to `string` until then.
 */
export type KnownLanguage = [keyof KnownLanguages] extends [never] ? string : keyof KnownLanguages;
