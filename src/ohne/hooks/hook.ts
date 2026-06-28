import type { AnyHookFn, HookFn, HookName } from './hooks.ts';

import { useHooks } from './use-hooks.ts';

/**
 * Registers `fn` as a callback for hook `name`.
 *
 * The callback is appended, so it runs after every callback registered before it.
 * Call this from a boot file.
 * Boot files run furthest-layer first, so order follows the layer stack, then file order within a layer.
 *
 * Its signature is checked against the hook's declared type in `Hooks`.
 *
 * @example
 * ```ts
 * hook('request:id', (id) => id.toUpperCase())
 * hook('server:ready', async () => { await warmCache() })
 * ```
 */
export function hook<K extends HookName>(name: K, fn: HookFn<K>): void {
  useHooks().register(name, [fn as AnyHookFn]);
}
