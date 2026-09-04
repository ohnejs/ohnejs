import type { LiteralUnion } from '../../utils/index.ts';

/**
 * Codegen extension point for the schema-derived capability names.
 * Empty until codegen runs; the `database.ts` it emits augments this with one member per capability.
 * Every collection contributes `collection.<Name>.<operation>` for the four API operations.
 * The per-collection wildcard `collection.<Name>.*`, `collection.*`, and `*` round out the set.
 * An app or layer adds its own names the same way, with `declare module 'ohne'`, so they complete too.
 *
 * `type` aliases cannot be augmented, so the capability names live on this interface instead.
 *
 * @example
 * ```ts
 * declare module 'ohne' {
 *   interface KnownCapabilities {
 *     'billing.export': true
 *   }
 * }
 * ```
 */
export interface KnownCapabilities {}

/**
 * A capability: a dot-separated permission string.
 * The generated names autocomplete once codegen has run; any other string stays legal.
 * A custom name carves its own namespace, so a layer's capabilities cannot collide with the schema's.
 * `*` covers everything, and a `.*` suffix covers every capability under its prefix.
 */
export type Capability = [keyof KnownCapabilities] extends [never]
  ? string
  : LiteralUnion<Extract<keyof KnownCapabilities, string>>;
