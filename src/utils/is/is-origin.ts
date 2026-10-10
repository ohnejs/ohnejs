import { isString } from './is-string.ts';

const HOSTNAME = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/;

/**
 * Checks whether a value is a bare http(s) origin, exactly as a browser serializes it.
 * Lowercase scheme and host, an optional non-default port, and no path, query or trailing slash.
 * The host is a domain name or an IPv4 address, so the value is safe to place in a header list.
 *
 * @example
 * ```ts
 * isOrigin('https://example.com')      // -> true
 * isOrigin('http://localhost:3000')    // -> true
 * isOrigin('https://example.com/')     // -> false
 * isOrigin('https://Example.com')      // -> false
 * isOrigin('https://example.com:443')  // -> false
 * isOrigin('https://*.example.com')    // -> false
 * isOrigin('https://a.dev;script-src') // -> false
 * isOrigin('ws://example.com')         // -> false
 * ```
 */
export function isOrigin(value: unknown): value is string {
  if (!isString(value)) return false;
  const url = URL.parse(value);
  return (
    (url?.protocol === 'https:' || url?.protocol === 'http:') &&
    url.origin === value &&
    HOSTNAME.test(url.hostname)
  );
}
