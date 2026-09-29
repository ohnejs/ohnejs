import type { RouteOptions } from './route-options.ts';
import type { Handler, HandlerContext } from './route.ts';

import { setRouteOptions } from './route-options.ts';

export type { RouteOptions, RouteRateLimit } from './route-options.ts';

/**
 * Defines a route handler.
 *
 * `params` is the route's param map and the result type is inferred from what you return.
 * Annotate the context to narrow `params` to specific keys when you want that.
 * Pass `options` to configure this route's request-handling limits or its middleware.
 * Override `maxBodySize`, `handlerTimeout`, or `waitUntilTimeout`, set a `rateLimit`, or add `middleware`.
 * At runtime this returns the handler unchanged, with any options attached for the transport to read.
 * Export the result as the file's default export so route discovery can pick it up.
 *
 * @example
 * ```ts
 * // api/authors/[id].get.ts
 * import { defineHandler } from 'ohnejs'
 *
 * export default defineHandler(({ params }) => ({ id: params.id }))
 * ```
 *
 * @example
 * ```ts
 * // api/search.get.ts - ten calls a minute per client, and `audit-log` after the global middleware
 * import { defineHandler } from 'ohnejs'
 *
 * export default defineHandler(() => search(), {
 *   rateLimit: { limit: 10, window: '1m' },
 *   middleware: ['audit-log'],
 * })
 * ```
 *
 * @example
 * ```ts
 * // api/admin/dashboard.get.ts - every named middleware except `audit-log`
 * import { defineHandler } from 'ohnejs'
 *
 * export default defineHandler(() => dashboard(), {
 *   middleware: (available) => available.filter((name) => name !== 'audit-log'),
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
