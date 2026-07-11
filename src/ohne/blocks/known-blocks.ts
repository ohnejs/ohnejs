/**
 * Codegen extension point for every known block name.
 * Empty until codegen runs; the `database.ts` it emits augments this with one member per block.
 * Each member maps the block name to its generated field shape.
 *
 * `type` aliases cannot be augmented, so the block names live on this interface instead.
 *
 * @example
 * ```ts
 * declare module 'ohne' {
 *   interface KnownBlocks extends GeneratedBlocks {}
 * }
 * ```
 */
export interface KnownBlocks {}

/**
 * Any block name in the app's combined schema.
 * Narrows to the generated union once codegen has run; falls back to `string` until then.
 */
export type BlockName = [keyof KnownBlocks] extends [never] ? string : keyof KnownBlocks;
