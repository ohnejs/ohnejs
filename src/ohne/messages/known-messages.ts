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
 * declare module 'ohnejs' {
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
 * A message key paired with its parameters as a `{ key, params }` object.
 * The `key` discriminates the union, so `params` is typed to exactly what the chosen template expects.
 * A param-free key carries no `params`: `{ key: 'validation.required' }` alone is valid.
 * Every param-free key shares one member, so the union stays small in an app with many messages.
 *
 * Until codegen populates `KnownMessages`, the object loosens to a plain `string` key and record.
 * A parameterized message then reads and type-checks without a cast.
 */
export type MessageObject = [keyof KnownMessages] extends [never]
  ? { key: string; params?: Record<string, unknown> }
  :
      | { key: ParamlessMessageKey; params?: never }
      | {
          [K in keyof KnownMessages]: [keyof KnownMessages[K]] extends [never]
            ? never
            : { key: K; params: KnownMessages[K] };
        }[keyof KnownMessages];

/**
 * Brands `UncheckedMessage`, so only a cast produces one.
 */
declare const unchecked: unique symbol;

/**
 * A `{ key, params }` message whose key the compiler cannot check against `KnownMessages`.
 * The framework builds one for a key in a catalog the app may disable, or in a layer outside the program.
 * Its brand exists only in the type, so app code keeps the checked `MessageObject` form.
 *
 * It is one type, not a union per key.
 * A function returning it on several paths, or a ternary choosing it, stays cheap to type-check.
 */
export interface UncheckedMessage {
  /**
   * Marks the message as cast, never written as a literal.
   */
  readonly [unchecked]: true;

  /**
   * The message key, resolved against whichever catalog is loaded at runtime.
   */
  key: string;

  /**
   * The values the key's template interpolates.
   */
  params?: Record<string, unknown>;
}

/**
 * A message to translate or show: a param-free key, a `{ key, params }` object, or a plain string.
 *
 * A param-free key is suggested for autocomplete, and any string is still allowed.
 * A `{ key, params }` object names any known key.
 * Its `params` member is required exactly when the key's template interpolates.
 * A plain string is shown as-is, or resolved when it matches a message key.
 * An `UncheckedMessage` carries a key the framework cannot check.
 */
export type Message = LiteralUnion<ParamlessMessageKey & string> | MessageObject | UncheckedMessage;
