import type { RateLimiter } from '../../utils/index.ts';
import type { AnyHandler, Route } from '../routes/route.ts';

import { createRateLimiter, isUndefined, parseBytes, parseDuration } from '../../utils/index.ts';
import { useRateLimitStore } from '../rate-limit/use-rate-limit-store.ts';
import { getRouteOptions } from '../routes/route-options.ts';
import { routeID } from '../routes/route.ts';

interface RouteLimits {
  maxBodySize: number | false | undefined;
  handlerTimeout: number | false | undefined;
  waitUntilTimeout: number | false | undefined;
}

const cache = new WeakMap<AnyHandler, RouteLimits>();

const limiters = new WeakMap<Route, RateLimiter | null>();

/**
 * Parses a byte size, passing `undefined` and `false` through.
 */
function resolveBytes(value: number | string | false | undefined): number | false | undefined {
  return isUndefined(value) || value === false ? value : parseBytes(value);
}

/**
 * Parses a duration to milliseconds, passing `undefined` and `false` through.
 */
function resolveMs(value: number | string | false | undefined): number | false | undefined {
  return isUndefined(value) || value === false ? value : parseDuration(value);
}

/**
 * Resolves a route handler's declared limit overrides, parsing byte and duration values.
 * The result is memoized per handler, so the parse runs once however many requests the route serves.
 *
 * A field is `undefined` when the handler declared no override, `false` when it opted out, else a number.
 * The caller folds these over the server-wide defaults.
 */
export function routeLimits(handler: AnyHandler): {
  maxBodySize: number | false | undefined;
  handlerTimeout: number | false | undefined;
  waitUntilTimeout: number | false | undefined;
} {
  const cached = cache.get(handler);
  if (!isUndefined(cached)) return cached;

  const options = getRouteOptions(handler);
  const limits: RouteLimits = {
    maxBodySize: resolveBytes(options?.maxBodySize),
    handlerTimeout: resolveMs(options?.handlerTimeout),
    waitUntilTimeout: resolveMs(options?.waitUntilTimeout),
  };
  cache.set(handler, limits);
  return limits;
}

/**
 * Returns the limiter a route's `rateLimit` declares, or `undefined` when the route is unlimited.
 * It counts in the app's rate-limit store, under the route's id, built once per route.
 * A `HEAD` served by its `GET` route shares that route's limiter.
 */
export function routeRateLimiter(route: Route): RateLimiter | undefined {
  if (!limiters.has(route)) {
    const rateLimit = getRouteOptions(route.handler)?.rateLimit;
    const name = `ohne:${routeID(route.method ?? null, route.pattern)}`;
    limiters.set(
      route,
      isUndefined(rateLimit)
        ? null
        : createRateLimiter({ ...rateLimit, name, store: useRateLimitStore() }),
    );
  }
  return limiters.get(route) ?? undefined;
}
