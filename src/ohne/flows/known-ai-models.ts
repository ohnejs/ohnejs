/**
 * Codegen extension point for every model a flow node may name.
 * Empty until a layer's codegen fills it; the assistant layer emits one member per `ai.models` entry.
 *
 * `type` aliases cannot be augmented, so the model names live on this interface instead.
 *
 * @example
 * ```ts
 * declare module 'ohnejs' {
 *   interface KnownAIModels {
 *     smart: true
 *   }
 * }
 * ```
 */
export interface KnownAIModels {}

/**
 * The name of a model a flow node may run on, as the app's `ai.models` names them.
 * Narrows to the generated union of names once codegen has run; falls back to `string` until then.
 */
export type AIModelName = [keyof KnownAIModels] extends [never] ? string : keyof KnownAIModels;
