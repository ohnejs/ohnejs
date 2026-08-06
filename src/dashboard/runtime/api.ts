import type { APIRouteID } from './known-api-routes.ts';

import { parseRouteID } from '../../utils/route/parse-route-id.ts';
import { dashboardConfig } from './config.ts';

/**
 * Fetches a route from the API the dashboard is configured for.
 * The `route` is a root-relative path, optionally prefixed with a method (`GET /authors/[id]`).
 * A leading method overrides `init.method`; the rest is the path appended to the base URL.
 * Requests carry credentials, so the session cookie flows to the API; `init.credentials` overrides.
 * Returns the raw `Response`; the caller decides how to read it.
 *
 * @example
 * ```ts
 * // Read matching records (a bare path defaults to GET)
 * const response = await api('/collections/posts?where={views:{atLeast:100}}&order=[-views]')
 * const posts = await response.json()
 *
 * // Create a record (the leading method sets the request method)
 * await api('POST /collections/posts', {
 *   headers: { 'content-type': 'application/json' },
 *   body: JSON.stringify({ title: 'Hello' }),
 * })
 * ```
 */
export function api(route: APIRouteID, init?: RequestInit): Promise<Response> {
  const { method, path } = parseRouteID(route);
  const request: RequestInit = { credentials: 'include', ...init };
  if (method) request.method = method;
  return fetch(`${dashboardConfig().apiURL}${path}`, request);
}
