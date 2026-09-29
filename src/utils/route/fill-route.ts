import type { RouteParams } from './compile-route.ts';

import { isUndefined } from '../is/is-undefined.ts';
import { ROUTE_PARAM_RE } from './_route-param.ts';

const DOT_SEGMENT = /^\.{0,2}$/;

/**
 * Fills each param of a route pattern with its value from `params`, percent-encoded.
 * A catch-all `[...name]` takes a value of several `/`-separated segments, each encoded on its own.
 * It throws on a missing param, and on a value that would change the path's shape.
 * A single-segment value holding `/`, or any segment that is empty, `.` or `..`, is refused.
 *
 * @example
 * ```ts
 * fillRoute('/collections/[collection]/[uuid]', { collection: 'Items', uuid: '42' })
 * // -> '/collections/Items/42'
 *
 * fillRoute('/authors/:name', { name: 'a b' })
 * // -> '/authors/a%20b'
 *
 * fillRoute('/files/[...path]', { path: 'maps/kalimdor.png' })
 * // -> '/files/maps/kalimdor.png'
 *
 * fillRoute('/authors/[id]', { id: '../admin' })
 * // -> throws
 * ```
 */
export function fillRoute(pattern: string, params: RouteParams): string {
  return pattern.replace(ROUTE_PARAM_RE, (_, catchAll, bracketed, colon) => {
    const name: string = bracketed ?? colon;
    const value = params[name];
    if (isUndefined(value)) throw new Error(`Missing route param \`${name}\``);
    const segments = catchAll ? value.split('/') : [value];
    if (segments.some((segment) => segment.includes('/') || DOT_SEGMENT.test(segment)))
      throw new Error(`Invalid route param \`${name}\`: ${JSON.stringify(value)}`);
    return segments.map(encodeURIComponent).join('/');
  });
}
