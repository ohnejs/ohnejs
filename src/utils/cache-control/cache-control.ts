import { isUndefined } from '../is/is-undefined.ts';

/**
 * Directives for a `Cache-Control` response header, built by `cacheControl`.
 * Durations are in seconds, not milliseconds.
 */
export interface CacheControlOptions {
  /**
   * Lets any cache store the response, as `public`.
   *
   * @default
   * false
   */
  public?: boolean;

  /**
   * Restricts storage to the browser, as `private`.
   *
   * @default
   * false
   */
  private?: boolean;

  /**
   * Forbids storing the response anywhere, as `no-store`.
   *
   * @default
   * false
   */
  noStore?: boolean;

  /**
   * Requires revalidation before each reuse, as `no-cache`.
   *
   * @default
   * false
   */
  noCache?: boolean;

  /**
   * Freshness lifetime in seconds, as `max-age`.
   */
  maxAge?: number;

  /**
   * Freshness lifetime for shared caches in seconds, as `s-maxage`.
   */
  sMaxAge?: number;

  /**
   * Forbids serving the response stale once expired, as `must-revalidate`.
   *
   * @default
   * false
   */
  mustRevalidate?: boolean;

  /**
   * Declares the response will not change while fresh, as `immutable`.
   *
   * @default
   * false
   */
  immutable?: boolean;

  /**
   * Seconds a stale response may be served while it revalidates, as `stale-while-revalidate`.
   */
  staleWhileRevalidate?: number;
}

/**
 * Builds a `Cache-Control` header value from a set of directives.
 * Durations are seconds, floored to whole seconds; `max-age=0` is emitted, an omitted field is not.
 *
 * @example
 * ```ts
 * cacheControl({ noStore: true })                     // -> 'no-store'
 * cacheControl({ public: true, maxAge: 3600 })        // -> 'public, max-age=3600'
 * cacheControl({ maxAge: 31536000, immutable: true }) // -> 'max-age=31536000, immutable'
 * ```
 */
export function cacheControl(options: CacheControlOptions): string {
  const directives: string[] = [];

  if (options.public) directives.push('public');
  if (options.private) directives.push('private');
  if (options.noStore) directives.push('no-store');
  if (options.noCache) directives.push('no-cache');
  if (!isUndefined(options.maxAge)) directives.push(`max-age=${Math.floor(options.maxAge)}`);
  if (!isUndefined(options.sMaxAge)) directives.push(`s-maxage=${Math.floor(options.sMaxAge)}`);
  if (options.mustRevalidate) directives.push('must-revalidate');
  if (options.immutable) directives.push('immutable');
  if (!isUndefined(options.staleWhileRevalidate))
    directives.push(`stale-while-revalidate=${Math.floor(options.staleWhileRevalidate)}`);

  return directives.join(', ');
}
