/**
 * Codegen extension point for every message key the dashboard may translate, and its parameters.
 * Empty until codegen runs; the `browser/messages.ts` it emits augments this with one member per key.
 * Each member maps a key to the object of parameters its ICU template expects.
 *
 * It mirrors the Node-side `KnownMessages`, so `useT` in the browser types a key exactly as the server does.
 * `type` aliases cannot be augmented, so the overridable keys live on this interface instead.
 *
 * @example
 * ```ts
 * declare module 'ohne/dashboard' {
 *   interface KnownMessages {
 *     'field.minLength': { min: number }
 *     'field.required': {}
 *   }
 * }
 * ```
 */
export interface KnownMessages {}

/**
 * Any message key the dashboard knows.
 * Narrows to the generated union of keys once codegen has run; falls back to `string` until then.
 */
export type MessageKey = [keyof KnownMessages] extends [never] ? string : keyof KnownMessages;
