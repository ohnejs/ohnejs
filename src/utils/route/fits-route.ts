import type { RouteParams } from './compile-route.ts';

import { isUndefined } from '../is/is-undefined.ts';
import { fitsParam, ROUTE_PARAM_RE } from './_route-param.ts';

/**
 * Whether `params` fill every param of a route pattern, so `fillRoute` would build its path.
 * A missing param, a single-segment value holding `/`, or an empty, `.` or `..` segment does not fit.
 *
 * @example
 * ```ts
 * fitsRoute('/blog/[slug]', { slug: 'hello' })   // -> true
 * fitsRoute('/blog/[slug]', { slug: 'a/b' })     // -> false
 * fitsRoute('/[...slug]', { slug: 'about/team' }) // -> true
 * ```
 */
export function fitsRoute(pattern: string, params: RouteParams): boolean {
  for (const [, catchAll, bracketed, colon] of pattern.matchAll(ROUTE_PARAM_RE)) {
    const value = params[(bracketed ?? colon)!];
    if (isUndefined(value) || !fitsParam(value, catchAll === '...')) return false;
  }
  return true;
}
