import type { HookFn, HookName } from './hooks.ts';

import { isUndefined } from '../../utils/index.ts';
import { useHooks } from './use-hooks.ts';

/**
 * Runs every callback registered for hook `name`, in registration order.
 *
 * Pass the hook's arguments after the name.
 * Callbacks run one at a time, each awaited before the next.
 * The order is deterministic whether the callbacks are sync or async.
 *
 * The first argument is the threaded value.
 * A callback that returns a value replaces it for the next callback.
 * A callback that returns `undefined` leaves it untouched.
 * The final value is returned.
 * An action is a hook whose callbacks return nothing.
 * It leaves the value untouched throughout, so its first argument comes back unchanged.
 *
 * Because `undefined` means "no change", a filter cannot thread `undefined` as a value.
 * Returning it is always read as leaving the value as it was.
 *
 * @example
 * ```ts
 * declare module 'ohne' {
 *   interface Hooks {
 *     'request:id': (id: string) => string
 *     'server:ready': () => void
 *   }
 * }
 *
 * const id = await applyHook('request:id', 'req_8f2a') // filter
 * await applyHook('server:ready')                      // action
 * ```
 */
export async function applyHook<K extends HookName>(
  name: K,
  ...args: Parameters<HookFn<K>>
): Promise<Parameters<HookFn<K>>[0]> {
  const callbacks = useHooks().get(name) ?? [];
  let [value, ...rest] = args as unknown[];
  for (const callback of callbacks) {
    const result = await (callback as (...a: unknown[]) => unknown)(value, ...rest);
    if (!isUndefined(result)) value = result;
  }
  return value as Parameters<HookFn<K>>[0];
}
