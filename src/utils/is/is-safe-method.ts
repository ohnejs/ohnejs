const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE']);

/**
 * Reports whether an HTTP method is safe per RFC 9110: it is read-only and has no server side effects.
 * The safe methods are `GET`, `HEAD`, `OPTIONS`, and `TRACE`.
 *
 * Method names are case-sensitive, matching the uppercase form a Web `Request` normalizes to.
 *
 * @example
 * ```ts
 * isSafeMethod('GET')  // -> true
 * isSafeMethod('POST') // -> false
 * ```
 */
export function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method);
}
