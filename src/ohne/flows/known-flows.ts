/**
 * Codegen extension point for every known flow name.
 * Empty until codegen runs; the `flows.ts` it emits augments this with one member per flow.
 *
 * `type` aliases cannot be augmented, so the flow names live on this interface instead.
 *
 * @example
 * ```ts
 * declare module 'ohnejs' {
 *   interface KnownFlows {
 *     'raid-officer': true
 *   }
 * }
 * ```
 */
export interface KnownFlows {}

/**
 * The name of a registered flow, as the files under `dirs.flows` name them.
 * Narrows to the generated union of names once codegen has run; falls back to `string` until then.
 */
export type FlowName = [keyof KnownFlows] extends [never] ? string : keyof KnownFlows;
