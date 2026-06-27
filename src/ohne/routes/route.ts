import type { HTTPMethod, RouteParams } from '../../utils/index.ts';

import { isNull } from '../../utils/index.ts';

/**
 * The context a route handler receives.
 */
export interface HandlerContext {
  /**
   * Params captured from the route pattern, keyed by name.
   * A `[id]` segment becomes `params.id`; a catch-all `[...path]` becomes `params.path`.
   *
   * @example
   * ```ts
   * // api/users/[id].get.ts, matched against /users/42
   * export default defineHandler(({ params }) => params.id) // -> '42'
   * ```
   */
  params: RouteParams;
}

/**
 * A route handler.
 * Takes a context and returns a result, synchronously or as a promise.
 */
export type Handler<C extends HandlerContext = HandlerContext, R = unknown> = (
  context: C,
) => R | Promise<R>;

/**
 * A handler as stored in the registry, with its context and result type erased.
 * Every `Handler` is assignable to it, whatever context it narrows `params` to.
 * The precise per-route types are recovered through `KnownRoutes` and `useAPI`.
 */
export type AnyHandler = Handler<never, unknown>;

/**
 * Static metadata for a route, independent of its handler.
 * This is what route discovery produces and what codegen serialises.
 */
export interface RouteMeta {
  /**
   * HTTP method, or `null` when the route answers any method.
   */
  method: HTTPMethod | null;

  /**
   * URL route pattern, always starting with `/`.
   */
  pattern: string;

  /**
   * Absolute path of the file the route was discovered in.
   */
  file: string;

  /**
   * Name of the layer that owns the route.
   */
  layer: string;
}

/**
 * A registered route: its metadata plus the resolved handler.
 */
export interface Route extends RouteMeta {
  /**
   * The handler invoked when the route matches.
   */
  handler: AnyHandler;
}

/**
 * Builds the registry id for a route from its method and pattern.
 *
 * A method-bound route is keyed as `'{METHOD} {pattern}'`; a method-agnostic route as the bare pattern.
 * Two routes collide only when both method and pattern match, so a closer layer overrides the same id.
 *
 * @example
 * ```ts
 * routeID('GET', '/users/[id]') // -> 'GET /users/[id]'
 * routeID(null, '/users/[id]')  // -> '/users/[id]'
 * ```
 */
export function routeID(method: HTTPMethod | null, pattern: string): string {
  return isNull(method) ? pattern : `${method} ${pattern}`;
}
