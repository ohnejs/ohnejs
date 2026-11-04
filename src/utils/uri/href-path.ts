/**
 * The path part of an `href`, without its query or hash.
 *
 * @example
 * ```ts
 * hrefPath('/jobs?status=failed') // -> '/jobs'
 * hrefPath('/docs#install')       // -> '/docs'
 * hrefPath('/jobs')               // -> '/jobs'
 * ```
 */
export function hrefPath(href: string): string {
  return href.split(/[?#]/, 1)[0]!;
}
