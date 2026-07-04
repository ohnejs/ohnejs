import type { APIRouteID } from './known-api-routes.ts';

import { parseRouteID } from '../../utils/route/parse-route-id.ts';
import { dashboardConfig } from './config.ts';

/**
 * Fetches a route from the API the dashboard is configured for.
 * The `route` is a root-relative path, optionally prefixed with a method (`GET /users/[id]`).
 * A leading method overrides `init.method`; the rest is the path appended to the base URL.
 * Returns the raw `Response`; the caller decides how to read it.
 */
export function api(route: APIRouteID, init?: RequestInit): Promise<Response> {
  const { method, path } = parseRouteID(route);
  return fetch(`${dashboardConfig().apiURL}${path}`, method ? { ...init, method } : init);
}
