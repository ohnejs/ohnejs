import type { RouteOptions } from './route-options.ts';
import type { Handler, HandlerContext } from './route.ts';

import { setRouteOptions } from './route-options.ts';

export type { RouteOptions } from './route-options.ts';

/**
 * Defines a route handler.
 *
 * `params` is the route's param map and the result type is inferred from what you return.
 * Annotate the context to narrow `params` to specific keys when you want that.
 * Pass `options` to override this route's request-handling limits (`maxBodySize`, `handlerTimeout`).
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
 */
export function defineHandler<C extends HandlerContext = HandlerContext, R = unknown>(
  handler: Handler<C, R>,
  options?: RouteOptions,
): Handler<C, R> {
  if (options) setRouteOptions(handler, options);
  return handler;
}
