import { isNull } from './is-null.ts';
import { isSafeMethod } from './is-safe-method.ts';

/**
 * The request facts a cross-origin write check reads.
 */
export interface CrossOriginRequest {
  /**
   * The HTTP method, uppercase.
   */
  method: string;

  /**
   * The `Origin` header, or `null` when absent.
   */
  origin: string | null;

  /**
   * The `Sec-Fetch-Site` header, or `null` when absent.
   */
  fetchSite: string | null;

  /**
   * The server's own origin, as `scheme://host[:port]`.
   */
  self: string;
}

/**
 * Reports whether an unsafe request comes from a browser page on another origin.
 * An origin in `trusted` counts as the server's own.
 *
 * It follows fetch metadata (`Sec-Fetch-Site`) first, and falls back to `Origin` for browsers without it.
 * A request with neither header is not from a browser, so it never counts as cross-origin.
 *
 * @example
 * ```ts
 * const request = {
 *   method: 'POST',
 *   origin: 'http://localhost:3000',
 *   fetchSite: 'same-site',
 *   self: 'http://localhost:9001',
 * }
 *
 * isCrossOriginWrite(request, [])                                       // -> true
 * isCrossOriginWrite(request, ['http://localhost:3000'])                // -> false
 * isCrossOriginWrite({ ...request, method: 'GET' }, [])                 // -> false
 * isCrossOriginWrite({ ...request, origin: null, fetchSite: null }, []) // -> false
 * ```
 */
export function isCrossOriginWrite(
  request: CrossOriginRequest,
  trusted: readonly string[],
): boolean {
  const { method, origin, fetchSite, self } = request;
  if (isSafeMethod(method)) return false;
  if (fetchSite === 'same-origin' || fetchSite === 'none') return false;
  if (!isNull(origin)) return origin !== self && !trusted.includes(origin);
  return !isNull(fetchSite);
}
