import type { Handler, HandlerContext } from './route.ts';

/**
 * Defines a route handler.
 *
 * `params` is the route's param map and the result type is inferred from what you return.
 * Annotate the context to narrow `params` to specific keys when you want that.
 * At runtime this is the identity function - it exists to anchor the types a handler file exports.
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
): Handler<C, R> {
  return handler;
}
