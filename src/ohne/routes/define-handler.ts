import type { RouteOptions } from './route-options.ts';
import type { Handler, HandlerContext } from './route.ts';

import { setRouteOptions } from './route-options.ts';

export type { RouteOptions } from './route-options.ts';

/**
 * Defines a route handler.
 *
 * `params` is the route's param map and the result type is inferred from what you return.
 * Annotate the context to narrow `params` to specific keys when you want that.
 * Pass `options` to configure this route's request-handling limits or its middleware.
 * Override `maxBodySize`, `handlerTimeout`, or `waitUntilTimeout`, or add named `middleware` to the route.
 * At runtime this returns the handler unchanged, with any options attached for the transport to read.
 * Export the result as the file's default export so route discovery can pick it up.
 *
 * @example
 * ```ts
 * // api/users/[id].get.ts
 * import { defineHandler } from 'ohne'
 *
 * export default defineHandler(({ params }) => ({ id: params.id }))
 * ```
 *
 * @example
 * ```ts
 * // api/search.get.ts - also run `rate-limit`, after the global middleware
 * import { defineHandler } from 'ohne'
 *
 * export default defineHandler(() => search(), { middleware: ['rate-limit'] })
 * ```
 *
 * @example
 * ```ts
 * // api/admin/dashboard.get.ts - every named middleware except `rate-limit`
 * import { defineHandler } from 'ohne'
 *
 * export default defineHandler(() => dashboard(), {
 *   middleware: (available) => available.filter((name) => name !== 'rate-limit'),
 * })
 * ```
 */
export function defineHandler<C extends HandlerContext = HandlerContext, R = unknown>(
  handler: Handler<C, R>,
  options?: RouteOptions,
): Handler<C, R> {
  if (options) setRouteOptions(handler, options);
  return handler;
}
