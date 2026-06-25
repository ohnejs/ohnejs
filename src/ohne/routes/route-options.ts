import type { AnyHandler } from './route.ts';

/**
 * Per-route overrides for the request-handling limits, declared on a handler through `defineHandler`.
 * Each field overrides the server-wide `Config.server` default for this one route.
 * A limit set to `false` opts the route out entirely, so the route owns its own bounding.
 */
export interface RouteOptions {
  /**
   * Largest request body this route accepts, as a `parseBytes` value, or `false` for no cap.
   * Overrides `server.maxBodySize` for this route.
   */
  maxBodySize?: number | string | false;

  /**
   * How long this route's middleware and handler may run, as a `parseDuration` value, or `false` for none.
   * Overrides `server.handlerTimeout` for this route.
   */
  handlerTimeout?: number | string | false;

  /**
   * How long this route's `waitUntil` work may run after the response, as a `parseDuration` value.
   * Set `false` for no deadline.
   * Overrides `server.waitUntilTimeout` for this route.
   */
  waitUntilTimeout?: number | string | false;
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
