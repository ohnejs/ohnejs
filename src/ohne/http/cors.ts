import type { Middleware } from '../middleware/middleware.ts';

import { isNull, isUndefined, toArray, vary } from '../../utils/index.ts';

const DEFAULT_METHODS = ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'];

/**
 * Origin policy and headers for a `cors` middleware.
 */
export interface CORSOptions {
  /**
   * Origins allowed to read cross-origin responses, matched exactly (scheme, host, and port).
   * Pass a single origin, a list, or `'*'` to allow any origin in public, credential-free mode.
   * There is no reflection mode: an origin not listed here receives no CORS headers.
   */
  origin: string | readonly string[];

  /**
   * Allow credentials (cookies, HTTP auth) on cross-origin requests, as `Access-Control-Allow-Credentials`.
   * Combining this with `origin: '*'` throws, since the browser forbids a credentialed wildcard.
   *
   * @default
   * false
   */
  credentials?: boolean;

  /**
   * Methods allowed on the actual request, sent in the preflight `Access-Control-Allow-Methods`.
   *
   * @default
   * ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE']
   */
  methods?: readonly string[];

  /**
   * Request headers allowed on the actual request, sent in the preflight `Access-Control-Allow-Headers`.
   * Omitted, the preflight reflects the request's `Access-Control-Request-Headers`.
   */
  allowHeaders?: readonly string[];

  /**
   * Response headers the browser may expose to script, as `Access-Control-Expose-Headers`.
   * Omitted, only the safelisted response headers are readable.
   */
  exposeHeaders?: readonly string[];

  /**
   * Seconds the browser may cache the preflight result, as `Access-Control-Max-Age`.
   * Omitted, the header is not sent and the browser uses its own short default.
   */
  maxAge?: number;
}

/**
 * Builds a CORS middleware from an origin policy.
 *
 * Mount it by default-exporting the result from a `middleware/` file: `export default cors({ origin })`.
 * On an allowed cross-origin request it sets `Access-Control-Allow-Origin`.
 * A non-`*` policy always appends `Vary: Origin`, even on a denied origin, so shared caches key per origin.
 * A preflight `OPTIONS` is answered with `204` and the allow headers.
 * An origin outside the allowlist gets no CORS headers, so the browser blocks the response.
 *
 * Safe by construction: there is no origin-reflection mode.
 * A wildcard `origin: '*'` with `credentials` throws, since the browser forbids it.
 * Order it before auth middleware so preflight short-circuits first.
 * CORS governs browser read-access only; it is never a substitute for authorization.
 *
 * @example
 * ```ts
 * // middleware/cors.ts
 * export default cors({ origin: ['https://app.example.com'], credentials: true })
 * ```
 */
export function cors(options: CORSOptions): Middleware {
  if (options.origin === '*' && options.credentials)
    throw new Error("cors: origin '*' cannot be combined with credentials; list explicit origins.");

  const wildcard = options.origin === '*';
  const origins = wildcard ? [] : toArray(options.origin);
  const methods = (options.methods ?? DEFAULT_METHODS).join(', ');
  const allowHeaders = options.allowHeaders?.join(', ');
  const exposeHeaders = options.exposeHeaders?.join(', ');
  const { credentials, maxAge } = options;

  return (event) => {
    const { request, response } = event;
    if (!wildcard) response.headers.set('vary', vary(response.headers.get('vary') ?? '', 'Origin'));

    const requestOrigin = request.headers.get('origin');
    if (isNull(requestOrigin)) return;

    const allowed = wildcard ? '*' : origins.includes(requestOrigin) ? requestOrigin : null;
    if (isNull(allowed)) return;

    response.headers.set('access-control-allow-origin', allowed);
    if (credentials) response.headers.set('access-control-allow-credentials', 'true');

    if (request.method === 'OPTIONS' && request.headers.has('access-control-request-method')) {
      response.headers.set('access-control-allow-methods', methods);
      const headers = allowHeaders ?? request.headers.get('access-control-request-headers');
      if (!isNull(headers) && headers !== '')
        response.headers.set('access-control-allow-headers', headers);
      if (!isUndefined(maxAge)) response.headers.set('access-control-max-age', String(maxAge));
      response.status = 204;
      return null;
    }

    if (!isUndefined(exposeHeaders))
      response.headers.set('access-control-expose-headers', exposeHeaders);
  };
}
