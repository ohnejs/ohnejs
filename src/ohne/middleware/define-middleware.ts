import type { Middleware } from './middleware.ts';

/**
 * Defines a request middleware.
 *
 * Middleware runs before the route handler, once per request, in name order.
 * It receives the request `event` (the same one `useEvent` returns) to read or mutate.
 * Return nothing to continue to the next middleware and then the handler.
 * Return a value to short-circuit: it becomes the response and the handler never runs.
 *
 * Default-export the result from a file in a layer's `middleware/` directory to register it.
 * Scope it to part of the app with `matchPath`, and share data with the handler through `event.context`.
 * To change which middleware run, or their order, per request, use the `middleware:resolve` hook.
 *
 * @example
 * ```ts
 * // middleware/auth.ts
 * import { defineMiddleware, matchPath, unauthorized } from 'ohne'
 *
 * export default defineMiddleware((event) => {
 *   if (!matchPath('/admin/**')) return
 *   const user = authenticate(event.request)
 *   if (!user) return unauthorized()
 *   event.context.auth = user
 * })
 * ```
 *
 * @example
 * ```ts
 * // boot/middleware.ts
 * import { hook } from 'ohne'
 *
 * hook('middleware:resolve', (names, event) =>
 *   isPublic(event) ? names.filter((name) => name !== 'auth') : names,
 * )
 * ```
 */
export function defineMiddleware(middleware: Middleware): Middleware {
  return middleware;
}
