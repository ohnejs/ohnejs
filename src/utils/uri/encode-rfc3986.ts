const RESERVED = /[!'()*]/g;

/**
 * Percent-encodes `value` so only the RFC 3986 unreserved characters stay literal.
 * `encodeURIComponent` leaves `!'()*` alone; this encodes them too, as signed URLs and query strings expect.
 *
 * @example
 * ```ts
 * encodeRFC3986('a b')      // -> 'a%20b'
 * encodeRFC3986("it's (1)") // -> 'it%27s%20%281%29'
 * encodeRFC3986('~a-b_c.d') // -> '~a-b_c.d'
 * ```
 */
export function encodeRFC3986(value: string): string {
  return encodeURIComponent(value).replace(
    RESERVED,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
