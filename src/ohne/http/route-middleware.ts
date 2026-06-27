import type { NamedMiddlewareKey } from '../middleware/known-middleware.ts';
import type { AnyHandler } from '../routes/route.ts';

import { isFunction, isUndefined, uniqueArray } from '../../utils/index.ts';
import { getRouteOptions } from '../routes/route-options.ts';

const cache = new WeakMap<AnyHandler, NamedMiddlewareKey[]>();

/**
 * Resolves the named middleware a route opts into, from its `defineHandler` `middleware` option.
 * This is only the named selection; the global middleware always run, separately, ahead of it.
 *
 * An array is the named middleware to run, in the given order.
 * A function receives `available` - every named middleware in the app - and returns the subset to run.
 * The result is de-duplicated and filtered to known names, so a repeat or an unknown name is dropped.
 *
 * `available` is read-only: return a new array, do not mutate it.
 * The selection is static over the named middleware, so the result is memoized per handler.
 * It resolves once however many requests the route serves.
 * Per-request changes belong to the `middleware:resolve` hook.
 * Returns `[]` when the route declared no middleware option.
 *
 * @example
 * ```ts
 * // handler opted into ['rate-limit']; 'audit-log' is available but unselected
 * routeMiddleware(handler, ['rate-limit', 'audit-log']) // -> ['rate-limit']
 * ```
 */
export function routeMiddleware(
  handler: AnyHandler,
  available: readonly NamedMiddlewareKey[],
): NamedMiddlewareKey[] {
  const cached = cache.get(handler);
  if (!isUndefined(cached)) return cached;

  const selection = getRouteOptions(handler)?.middleware;
  const chosen = isUndefined(selection)
    ? []
    : isFunction(selection)
      ? selection(available)
      : selection;
  const resolved = uniqueArray(chosen.filter((name) => available.includes(name)));
  cache.set(handler, resolved);
  return resolved;
}
