import { isLocalPath } from '../route/is-local-path.ts';
import { isFetchableURL } from '../uri/is-fetchable-url.ts';

const CONTROL = /\p{Cc}/u;
const PLAIN_SCHEMES = new Set(['mailto:', 'tel:']);

/**
 * Whether `value` may be an `href` in user content: a browser can neither run it nor silently rewrite it.
 * It admits `http:` and `https:` without userinfo, `mailto:`, `tel:`, a local `/path`, and a `#fragment`.
 * Padding and control characters refuse, since a browser drops tabs and newlines and `java\tscript:` runs.
 *
 * @example
 * ```ts
 * isSafeHref('https://x.y')          // -> true
 * isSafeHref('mailto:a@b.c')         // -> true
 * isSafeHref('/a?b#c')               // -> true
 * isSafeHref('#top')                 // -> true
 * isSafeHref('javascript:alert(1)')  // -> false
 * isSafeHref('java\tscript:x')       // -> false
 * isSafeHref('//evil.com')           // -> false
 * isSafeHref('https://x.y@evil.com') // -> false
 * isSafeHref(' https://x.y')         // -> false
 * ```
 */
export function isSafeHref(value: string): boolean {
  if (value !== value.trim() || CONTROL.test(value)) return false;
  if (value.startsWith('#')) return true;
  if (value.startsWith('/')) return isLocalPath(value);
  const url = URL.parse(value);
  if (!url) return false;
  return isFetchableURL(url) || PLAIN_SCHEMES.has(url.protocol);
}
