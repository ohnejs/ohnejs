import type { Middleware } from './middleware.ts';

/**
 * Defines a request middleware.
 *
 * Middleware runs before the route handler, once per request.
 * It receives the request `event` (the same one `useEvent` returns) to read or mutate.
 * Return nothing to continue to the next middleware and then the handler.
 * Return a value to short-circuit: it becomes the response and the handler never runs.
 *
 * Default-export the result from a file in a layer's `middleware/` directory to register it.
 * Where the file sits decides when it runs:
 * - under `middleware/global/`, it runs on every request, in name order;
 * - anywhere else, it is opt-in - a route runs it through `defineHandler`'s `middleware` option.
 *
 * A route runs every global middleware, plus the named ones it opts into, and nothing else.
 * Scope a middleware to part of the app with `matchPath`, and share data through `event.context`.
 * `matchPath` and the route's `middleware` option are the primary controls over what runs.
 * The `middleware:resolve` hook is a last resort, for dynamic per-request decisions.
 *
 * @example
 * ```ts
 * // middleware/global/session.ts - runs on every request
 * import { defineMiddleware, matchPath, unauthorized } from 'ohnejs'
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
 * // middleware/audit-log.ts - opt-in, named `audit-log`
 * import { defineMiddleware } from 'ohnejs'
 *
 * export default defineMiddleware((event) => {
 *   console.info(`${event.request.method} ${event.url.pathname} from ${event.ip}`)
 * })
 *
 * // api/search.get.ts - runs the global middleware, plus audit-log
 * import { defineHandler } from 'ohnejs'
 *
 * export default defineHandler(() => search(), { middleware: ['audit-log'] })
 * ```
 */
export function defineMiddleware(middleware: Middleware): Middleware {
  return middleware;
}
