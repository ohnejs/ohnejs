import type { RouteParams } from '../../utils/index.ts';

import { useEvent } from './use-event.ts';

/**
 * Returns the params captured from the route pattern, keyed by name.
 * Shorthand for `useEvent().params`; valid only within a request.
 *
 * A `[id]` segment becomes `params.id`; a catch-all `[...path]` becomes `params.path`.
 * Values are the raw matched substrings, not URI-decoded.
 *
 * @example
 * ```ts
 * // api/authors/[id].get.ts, matched against /authors/42
 * useRouteParams().id // -> '42'
 * ```
 */
export function useRouteParams(): RouteParams {
  return useEvent().params;
}
