import type { APIRouteID } from './known-api-routes.ts';

import { untracked } from '../../utils/reactive/untracked.ts';
import { handleUnauthorized, requestTarget, withAcceptLanguage } from './_request.ts';
import { dashboardConfig } from './config.ts';
import { useDashboardLanguage } from './use-dashboard-language.ts';

export { setUnauthorizedHandler } from './_request.ts';

/**
 * Fetches a route from the API the dashboard is configured for.
 * The `route` is a root-relative path, optionally prefixed with a method (`GET /authors/[id]`).
 * A leading method overrides `init.method`; the rest is the path appended to the base URL.
 * Requests carry credentials, so the session cookie flows to the API; `init.credentials` overrides.
 * They also carry `Accept-Language` for the dashboard language, so answers speak it; a given one wins.
 * A `401` from a route outside `/auth/` calls the handler installed with `setUnauthorizedHandler`.
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
export async function api(route: APIRouteID, init?: RequestInit): Promise<Response> {
  const { method, path, url } = requestTarget(dashboardConfig().apiURL, route);
  // Untracked: a fetch started inside a render must not subscribe that region to the language.
  const language = untracked(() => useDashboardLanguage().value);
  const request: RequestInit = {
    credentials: 'include',
    ...init,
    headers: withAcceptLanguage(init?.headers, language),
  };
  if (method) request.method = method;
  const response = await fetch(url, request);
  handleUnauthorized(response.status, path);
  return response;
}
