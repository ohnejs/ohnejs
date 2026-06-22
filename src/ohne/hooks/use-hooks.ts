import type { AnyHookFn } from './hooks.ts';

import { createRegistry, type Registry } from '../../utils/index.ts';

const registry: Registry<AnyHookFn[]> = createRegistry<AnyHookFn[]>({
  merge: (existing, incoming) => [...existing, ...incoming],
});

/**
 * Returns the process-wide hook registry, keyed by hook name.
 *
 * Each name holds the callbacks registered for it, in registration order.
 * The boot files populate it at start via `hook`; call sites read it through `applyHook`.
 * Registering appends, so every layer and every boot file adds to the same chain.
 *
 * Extend the typed shape via `declare module 'ohne'`.
 *
 * @example
 * ```ts
 * useHooks().register('render:html:before', [(html) => html.trim()])
 * useHooks().get('render:html:before')?.length // -> 1
 * ```
 */
export function useHooks(): Registry<AnyHookFn[]> {
  return registry;
}
