import type { RouteParams } from './compile-route.ts';

/**
 * URI-decodes each captured route param, leaving a malformed percent-sequence as its raw value.
 * `compileRoute` returns raw matched substrings, so a consumer decodes them through this.
 *
 * @example
 * ```ts
 * decodeRouteParams({ name: 'a%20b' }) // -> { name: 'a b' }
 * decodeRouteParams({ id: '42' })      // -> { id: '42' }
 * decodeRouteParams({ x: '%zz' })      // -> { x: '%zz' }
 * ```
 */
export function decodeRouteParams(params: RouteParams): RouteParams {
  const out: RouteParams = {};
  for (const key in params) {
    const value = params[key];
    out[key] = value.includes('%') ? safeDecode(value) : value;
  }
  return out;
}

/**
 * URI-decodes a string, returning it unchanged when a percent-sequence is malformed.
 */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
