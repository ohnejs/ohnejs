import type { Middleware } from './middleware.ts';

import { createRegistry, type Registry } from '../../utils/index.ts';

const registry: Registry<Middleware> = createRegistry<Middleware>();

/**
 * Returns the process-wide middleware registry, keyed by resolved name.
 *
 * The generated `middleware.ts` populates it at boot, in run order.
 * Each middleware is statically imported and registered under its name.
 * Registering an existing name overrides it, so a closer layer's middleware wins.
 * `dispatch` runs them in registration order, before the route handler.
 *
 * @example
 * ```ts
 * useMiddleware().register('auth', (event) => {
 *   event.context.requestId = crypto.randomUUID()
 * })
 *
 * Object.values(useMiddleware().all()) // -> [the auth middleware]
 * ```
 */
export function useMiddleware(): Registry<Middleware> {
  return registry;
}
