/**
 * Typed hook table.
 * Add hooks by augmenting it from a layer with `declare module 'ohne'`.
 *
 * Name a hook `group:name` in kebab-case, then type it as its callback signature.
 * A hook whose callbacks return nothing is an action, run for effect.
 * A hook whose callbacks return a value is a filter: each return feeds the next callback.
 *
 * @example
 * ```ts
 * declare module 'ohne' {
 *   interface Hooks {
 *     'render:html:before': (html: string) => string
 *     'server:ready': () => void | Promise<void>
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
