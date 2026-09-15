import type { AnyHandler } from '../routes/route.ts';

import { isUndefined, parseBytes, parseDuration } from '../../utils/index.ts';
import { getRouteOptions } from '../routes/route-options.ts';

interface RouteLimits {
  maxBodySize: number | false | undefined;
  handlerTimeout: number | false | undefined;
  waitUntilTimeout: number | false | undefined;
}

const cache = new WeakMap<AnyHandler, RouteLimits>();

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
