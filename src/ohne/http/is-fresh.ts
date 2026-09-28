import { isNull } from '../../utils/index.ts';
import { useEvent } from './use-event.ts';

const noCache = /(?:^|,)\s*no-cache\s*(?:,|$)/i;

/**
 * Whether any tag in an `If-None-Match` list equals `etag`, ignoring a `W/` prefix on either side.
 */
function matchesETag(noneMatch: string, etag: string): boolean {
  for (const candidate of noneMatch.split(',')) {
    const tag = candidate.trim();
    if (tag === etag || tag === `W/${etag}` || `W/${tag}` === etag) return true;
  }
  return false;
}

/**
 * Reports whether the client's cached copy is still fresh, so the handler can answer `304`.
 * Compares the request's `If-None-Match` / `If-Modified-Since` against the response's validators.
 * Set the response's `ETag` / `Last-Modified` first; valid only within a request.
 *
 * `If-None-Match` wins when present and is compared weakly (the `W/` prefix is ignored).
 * `*` matches any current representation, and a `Cache-Control: no-cache` request is never fresh.
 * With neither validator, or no matching response header, the copy is stale.
 *
 * @example
 * ```ts
 * useResponse().headers.set('etag', etag(body))
 * if (isFresh()) return sendNotModified()
 * return body
 * ```
 */
export function isFresh(): boolean {
  const { request, response } = useEvent();
  const noneMatch = request.headers.get('if-none-match');
  const modifiedSince = request.headers.get('if-modified-since');
  if (isNull(noneMatch) && isNull(modifiedSince)) return false;

  const cacheControl = request.headers.get('cache-control');
  if (!isNull(cacheControl) && noCache.test(cacheControl)) return false;

  if (!isNull(noneMatch)) {
    if (noneMatch === '*') return true;
    const tag = response.headers.get('etag');
    return !isNull(tag) && matchesETag(noneMatch, tag);
  }

  if (!isNull(modifiedSince)) {
    const lastModified = response.headers.get('last-modified');
    return !isNull(lastModified) && Date.parse(lastModified) <= Date.parse(modifiedSince);
  }

  return false;
}
