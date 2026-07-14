import type { LiteralUnion } from '../../utils/index.ts';

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

/**
 * A message key whose ICU template interpolates no parameters.
 * These are the keys usable on their own, without an accompanying parameter object.
 */
export type ParamlessMessageKey = {
  [K in keyof KnownMessages]: [keyof KnownMessages[K]] extends [never] ? K : never;
}[keyof KnownMessages];

/**
 * A message key that takes parameters, paired with them as a `[key, params]` tuple.
 * The parameter object is typed to exactly the keys the chosen message's template expects.
 */
export type MessageTuple = {
  [K in keyof KnownMessages]: [keyof KnownMessages[K]] extends [never]
    ? never
    : [K, KnownMessages[K]];
}[keyof KnownMessages];

/**
 * A message to translate or show: a param-free key, a `[key, params]` tuple, or a plain string.
 *
 * A param-free key is suggested for autocomplete, and any string is still allowed.
 * A `[key, params]` tuple names a parameterized message and its interpolation values, both exactly typed.
 * A plain string is shown as-is, or resolved when it matches a message key.
 */
export type Message = LiteralUnion<ParamlessMessageKey & string> | MessageTuple;
