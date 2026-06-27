/**
 * Codegen extension point for every known message key and its parameters.
 * Empty until codegen runs; the `messages.ts` it emits augments this with one member per key.
 * Each member maps a key to the object of parameters its ICU template expects.
 *
 * `type` aliases cannot be augmented, so the overridable keys live on this interface instead.
 *
 * @example
 * ```ts
 * declare module 'ohne' {
 *   interface KnownMessages {
 *     'field.minLength': { min: number }
 *     'field.required': {}
 *   }
 * }
 * ```
 */
export interface KnownMessages {}

/**
 * Any message key in the app's combined catalog.
 * Narrows to the generated union of keys once codegen has run; falls back to `string` until then.
 */
export type MessageKey = [keyof KnownMessages] extends [never] ? string : keyof KnownMessages;
