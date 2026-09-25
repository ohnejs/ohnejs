import { isUndefined } from '../is/is-undefined.ts';
import { isFetchableURL } from '../uri/is-fetchable-url.ts';
import { fetchPublicError } from './_fetch-public-error.ts';

/**
 * The URL a redirect leads to: `location` resolved against `current`, then vetted like the first URL.
 * A missing or unparseable `location` is `unreachable`, since the response is broken.
 * A target that is not fetchable, or that drops from `https:` to `http:`, is `refused`.
 * Its address is vetted when the hop connects, like any other.
 *
 * @example
 * ```ts
 * nextHop('/b.png', new URL('https://example.com/a'))             // -> https://example.com/b.png
 * nextHop('http://example.com/', new URL('https://example.com/')) // -> throws with code 'refused'
 * ```
 */
export function nextHop(location: string | undefined, current: URL): URL {
  const next = isUndefined(location) ? null : URL.parse(location, current);
  if (!next) throw fetchPublicError('unreachable');
  const downgrade = current.protocol === 'https:' && next.protocol === 'http:';
  if (!isFetchableURL(next) || downgrade) throw fetchPublicError('refused');
  return next;
}
