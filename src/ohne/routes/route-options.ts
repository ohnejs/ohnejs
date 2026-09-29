import type { NamedMiddlewareKey } from '../middleware/known-middleware.ts';
import type { AnyHandler } from './route.ts';

/**
 * Per-route configuration, declared on a handler through `defineHandler`.
 * Each size and timeout field overrides the server-wide `Config.api` default for this one route.
 * One set to `false` opts the route out entirely, so the route owns its own bounding.
 * The `middleware` field selects which named middleware run for the route, after the global ones.
 */
export interface RouteOptions {
  /**
   * Largest request body this route accepts, as bytes or `'10mb'`, or `false` for no cap.
   * Overrides `api.maxBodySize` for this route.
   */
  maxBodySize?: number | string | false;

  /**
   * How long this route's middleware and handler may run, as milliseconds or `'30s'`, or `false` for none.
   * Overrides `api.handlerTimeout` for this route.
   */
  handlerTimeout?: number | string | false;

  /**
   * How long this route's `waitUntil` work may run after the response, as milliseconds or `'60s'`.
   * Set `false` for no deadline.
   * Overrides `api.waitUntilTimeout` for this route.
   */
  waitUntilTimeout?: number | string | false;

  /**
   * How often one client may call this route, past which it answers `429` with `Retry-After`.
   * Checked after the middleware, before the body is read.
   * Omitted, the route is unlimited; there is no server-wide default.
   */
  rateLimit?: RouteRateLimit;

  /**
   * Named middleware this route opts into, run after the always-on global middleware.
   * The global middleware run on every request; this adds named ones on top, it cannot disable them.
   * Omitted, the route runs the global middleware only.
   *
   * An array lists the named middleware to run, in order.
   * A function receives every named middleware in the app and returns the subset to run.
   * Duplicate and unknown names are dropped.
   */
  middleware?:
    | NamedMiddlewareKey[]
    | ((available: readonly NamedMiddlewareKey[]) => NamedMiddlewareKey[]);
}

/**
 * A route's rate limit, counted per client.
 * A client may spend the whole `limit` at once, then regains one call every `window / limit`.
 */
export interface RouteRateLimit {
  /**
   * How many calls one client may make in one `window`.
   */
  limit: number;

  /**
   * The span `limit` refills over, as milliseconds or `'1m'`.
   */
  window: number | string;
}

const OPTIONS = Symbol('ohne.routeOptions');

interface WithOptions {
  [OPTIONS]?: RouteOptions;
}

/**
 * Attaches route options to a handler, read later by the transport.
 * Stored under a symbol, so it never shows up as an enumerable property of the handler.
 */
export function setRouteOptions(handler: AnyHandler, options: RouteOptions): void {
  Object.defineProperty(handler, OPTIONS, { value: options, configurable: true });
}

/**
 * Reads the route options attached to a handler, or `undefined` when none were declared.
 */
export function getRouteOptions(handler: AnyHandler): RouteOptions | undefined {
  return (handler as WithOptions)[OPTIONS];
}
