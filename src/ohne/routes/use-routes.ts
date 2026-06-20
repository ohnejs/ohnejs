import type { Route } from './route.ts';

import { createRegistry, type Registry } from '../../utils/index.ts';

const registry: Registry<Route> = createRegistry<Route>();

/**
 * Returns the process-wide route registry, keyed by route id.
 *
 * The generated `routes.ts` populates it at boot.
 * Each route's handler is statically imported and registered under its id.
 * Registering an existing id overrides it, so a route emitted by a closer layer wins.
 * Read the table with `all`, or reach for `useAPI` for the typed view.
 *
 * @example
 * ```ts
 * useRoutes().register('GET /users/[id]', {
 *   method: 'GET',
 *   pattern: '/users/[id]',
 *   file: '/app/api/users/[id].get.ts',
 *   layer: 'my-app',
 *   handler,
 * })
 *
 * useRoutes().get('GET /users/[id]')?.pattern // -> '/users/[id]'
 * ```
 */
export function useRoutes(): Registry<Route> {
  return registry;
}
