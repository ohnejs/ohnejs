/**
 * Typed hook table.
 * Add hooks by augmenting it from a layer with `declare module 'ohnejs'`.
 *
 * Name a hook `group:name`, then type it as its callback signature.
 * Both segments are kebab-case, never camelCase: a multi-word name is `record:before-change`.
 * A hook whose callbacks return nothing is an action, run for effect.
 * A hook whose callbacks return a value is a filter: each return feeds the next callback.
 *
 * @example
 * ```ts
 * declare module 'ohnejs' {
 *   interface Hooks {
 *     'query:filter': (ir: QueryIR) => void | QueryIR | Promise<void | QueryIR>
 *     'server:ready': (info: { host: string; port: number }) => void | Promise<void>
 *   }
 * }
 * ```
 */
export interface Hooks {}

/**
 * A hook callback with its parameters and result erased.
 * Every declared hook signature is assignable to it, like `AnyHandler` for routes.
 * The precise per-hook types are recovered through `Hooks` and `HookFn`.
 */
export type AnyHookFn = (...args: never[]) => unknown;

/**
 * The name of a hook.
 * Narrows to the union of declared hook names once `Hooks` is augmented; falls back to `string`.
 */
export type HookName = [keyof Hooks] extends [never] ? string : keyof Hooks;

/**
 * The callback type for hook `K`.
 * Recovers the declared signature from `Hooks`; falls back to `AnyHookFn` before augmentation.
 */
export type HookFn<K extends HookName> = K extends keyof Hooks
  ? Hooks[K] extends AnyHookFn
    ? Hooks[K]
    : AnyHookFn
  : AnyHookFn;
