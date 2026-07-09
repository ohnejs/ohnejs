import type { boolean } from './builtin/boolean.ts';
import type { integer } from './builtin/integer.ts';
import type { text } from './builtin/text.ts';

/**
 * The registered field types, each name mapped to its definition.
 * ohne's built-ins are always present; codegen augments this with each layer's own.
 * `field('<name>', ...)` reads the mapped definition to resolve that type's options.
 *
 * `type` aliases cannot be augmented, so the extra names live on this interface instead.
 *
 * @example
 * ```ts
 * declare module 'ohne' {
 *   interface KnownFields {
 *     slug: typeof import('./fields/slug.ts').default
 *   }
 * }
 * ```
 */
export interface KnownFields {
  /**
   * A text value.
   */
  text: typeof text;

  /**
   * A whole number, within JavaScript's safe integer range.
   */
  integer: typeof integer;

  /**
   * A true or false value.
   */
  boolean: typeof boolean;
}

/**
 * The name of a registered field type, used as the string tag of `field(...)`.
 * Always includes the built-ins, plus any a layer adds through codegen.
 */
export type FieldTypeName = keyof KnownFields;
