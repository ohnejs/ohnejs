import type { ShutdownHook } from './use-shutdown.ts';

import { useShutdown } from './use-shutdown.ts';

/**
 * Registers a teardown hook with the shutdown coordinator.
 *
 * Hooks run in registration order when the process shuts down, each awaited before the next.
 * Sugar over `useShutdown().add`; reach for it from a boot file or a subsystem's setup.
 *
 * @example
 * ```ts
 * onShutdown(async () => { await db.close() })
 * onShutdown(() => server.close())
 * ```
 */
export function onShutdown(hook: ShutdownHook): void {
  useShutdown().add(hook);
}
