import { isUndefined } from '../is/is-undefined.ts';

const WILDCARDS = new Set(['0.0.0.0', '::']);

/**
 * The `http` origin that reaches a server listening on `host` and `port`.
 * An absent or wildcard host becomes `localhost`, since the server then answers on loopback too.
 * An IPv6 address gets the brackets a URL needs.
 *
 * @example
 * ```ts
 * listenOrigin(undefined, 9000)   // -> 'http://localhost:9000'
 * listenOrigin('0.0.0.0', 9000)   // -> 'http://localhost:9000'
 * listenOrigin('127.0.0.1', 9000) // -> 'http://127.0.0.1:9000'
 * listenOrigin('::1', 9000)       // -> 'http://[::1]:9000'
 * ```
 */
export function listenOrigin(host: string | undefined, port: number): string {
  if (isUndefined(host) || WILDCARDS.has(host)) return `http://localhost:${port}`;
  return `http://${host.includes(':') ? `[${host}]` : host}:${port}`;
}
