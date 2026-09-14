/**
 * Codegen extension point for the known layer names.
 * Empty until codegen runs; the `layer-name.ts` it emits augments this with one member per layer.
 *
 * `type` aliases cannot be augmented, so the overridable names live on this interface instead.
 *
 * @example
 * ```ts
 * declare module 'ohnejs' {
 *   interface KnownLayers {
 *     base: true
 *     user: true
 *   }
 * }
 * ```
 */
export interface KnownLayers {}

/**
 * The name of a layer in the app's ohne dependency closure.
 * Narrows to the generated union of layer names once codegen has run; falls back to `string` until then.
 */
export type LayerName = [keyof KnownLayers] extends [never] ? string : keyof KnownLayers;
