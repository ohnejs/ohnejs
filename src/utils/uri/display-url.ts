import { withoutTrailingSlash } from '../path/without-trailing-slash.ts';

/**
 * The address as people say it: the host and path, without the scheme and a trailing slash.
 * The query and the fragment are dropped.
 *
 * @example
 * ```ts
 * displayURL('https://mein.webgepflegt.de/K7M4X-Q2PZR') // -> 'mein.webgepflegt.de/K7M4X-Q2PZR'
 * displayURL('https://example.com/')                    // -> 'example.com'
 * displayURL('http://localhost:3000/docs/?q=1')         // -> 'localhost:3000/docs'
 * ```
 */
export function displayURL(url: string): string {
  const { host, pathname } = new URL(url);
  return `${host}${withoutTrailingSlash(pathname)}`;
}
