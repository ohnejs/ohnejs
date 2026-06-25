import type { IncomingMessage, Server, ServerOptions, ServerResponse } from 'node:http';

import { createServer as createNodeServer } from 'node:http';

import type { Gate, HTTPMethod } from '../../utils/index.ts';
import type { RouteMatch, Router } from './router.ts';

import {
  createCIDRMatcher,
  createGate,
  createHostMatcher,
  isNull,
  isUndefined,
  parseBytes,
  parseDuration,
} from '../../utils/index.ts';
import { usePrinter } from '../printer/use-printer.ts';
import { clientIP, sendResponse, toRequest, toURL } from './adapter.ts';
import { dispatch } from './dispatch.ts';
import { HTTPError } from './http-error.ts';
import { routeLimits } from './route-limits.ts';
import { toResponse } from './to-response.ts';

/**
 * A built HTTP server: the Node transport and the drain gate it admits requests through.
 */
export interface HTTPServer {
  /**
   * The Node server.
   * Call `listen` to start accepting; pass it and `gate` to `shutdownServer` to drain.
   */
  server: Server;

  /**
   * The drain gate, one ticket per in-flight request.
   * A request holds its ticket until the response is written and its `waitUntil` work settles.
   */
  gate: Gate;
}

/**
 * Transport-level limits for `createServer`.
 * An omitted field keeps Node's own default.
 */
export interface CreateServerOptions {
  /**
   * How long the server waits for the complete request headers, as a `parseDuration` value.
   * Omitted keeps Node's default of 60 seconds.
   *
   * @example
   * ```ts
   * 10000   // 10 seconds, as raw milliseconds
   * '10s'   // 10 seconds
   * '500ms' // half a second
   * ```
   */
  headersTimeout?: number | string;

  /**
   * How long the server allows for the entire request, headers and body, as a `parseDuration` value.
   * Omitted keeps Node's default of 5 minutes.
   *
   * @example
   * ```ts
   * 30000 // 30 seconds, as raw milliseconds
   * '30s' // 30 seconds
   * '1m'  // one minute
   * ```
   */
  requestTimeout?: number | string;

  /**
   * How long an idle keep-alive socket is held open between requests, as a `parseDuration` value.
   * Omitted keeps Node's default of 5 seconds.
   *
   * @example
   * ```ts
   * 5000    // 5 seconds, as raw milliseconds
   * '5s'    // 5 seconds
   * '500ms' // half a second
   * ```
   */
  keepAliveTimeout?: number | string;

  /**
   * Maximum number of concurrent sockets the server accepts.
   * Omitted keeps Node's default of no limit.
   */
  maxConnections?: number;

  /**
   * Largest total request header block to accept, as a `parseBytes` value.
   * Caps the request line and all headers; the parser refuses anything larger before routing.
   * Omitted keeps Node's default of 16 KiB.
   *
   * @example
   * ```ts
   * 32768  // 32 KiB, as raw bytes
   * '32kb' // 32 KiB
   * ```
   */
  maxHeaderSize?: number | string;

  /**
   * Largest request body to accept, as a `parseBytes` value.
   * An over-cap `Content-Length` is refused with `413` before any body is read.
   * A body that overruns mid-stream aborts with the same `413`.
   * Omitted leaves the body size unbounded.
   *
   * @example
   * ```ts
   * 1048576 // one mebibyte, as raw bytes
   * '1mb'   // one mebibyte
   * '512kb' // half a mebibyte
   * ```
   */
  maxBodySize?: number | string;

  /**
   * How long middleware and the handler may run before the request is answered with `503`.
   * A `parseDuration` value, distinct from `requestTimeout`, which bounds the socket, not the work.
   * Omitted lets the handler run without a deadline.
   *
   * @example
   * ```ts
   * 30000 // 30 seconds, as raw milliseconds
   * '30s' // 30 seconds
   * '1m'  // one minute
   * ```
   */
  handlerTimeout?: number | string;

  /**
   * How long a `waitUntil` promise may run after the response before it is abandoned.
   * A `parseDuration` value; on overrun the promise is logged and the request's drain ticket released.
   * Omitted lets background work run without a deadline.
   *
   * @example
   * ```ts
   * 60000 // 60 seconds, as raw milliseconds
   * '60s' // 60 seconds
   * '5m'  // five minutes
   * ```
   */
  waitUntilTimeout?: number | string;

  /**
   * CIDR ranges of proxies allowed to set `X-Forwarded-*`.
   * When the immediate peer is in one of these ranges, `X-Forwarded-Proto`/`X-Forwarded-Host` are honored.
   * They override the socket's own scheme and host.
   * An empty list (the default) trusts no proxy.
   *
   * @example
   * ```ts
   * ['10.0.0.0/8']       // a private network of proxies
   * ['127.0.0.1', '::1'] // a local reverse proxy
   * ```
   */
  trustProxy?: string[];

  /**
   * Hostnames the server answers to, matched against the request's `Host` (the port is ignored).
   * A `Host` outside the list is refused with `400` before routing.
   * Each entry is a `compileGlob` pattern, so `'*.example.com'` matches any subdomain.
   * An empty list (the default) answers to any host.
   *
   * @example
   * ```ts
   * ['example.com', '*.example.com'] // the apex and its subdomains
   * ['localhost', '127.0.0.1']       // local development
   * ```
   */
  allowedHosts?: string[];
}

/**
 * Builds the HTTP transport for a route table.
 *
 * Each request takes a gate ticket, is matched, dispatched, and serialized.
 * The ticket is released once the response is written and its background work drains.
 * A request that arrives while the gate is closing is refused with `503` and a `Connection: close`.
 * A path that matches no route is a `404`; one that matches but not for the method is a `405` with `Allow`.
 * The transport limits in `options` are applied to the Node server; an omitted field keeps Node's default.
 *
 * The returned server is not listening; the caller starts it and wires shutdown.
 *
 * @example
 * ```ts
 * const { server, gate } = createServer(createRouter(routes))
 * server.listen(3000)
 * onShutdown(() => shutdownServer(server, gate, { shutdownTimeout: '10s' }))
 * ```
 */
export function createServer(router: Router, options: CreateServerOptions = {}): HTTPServer {
  const gate = createGate();
  const limits: RequestLimits = {
    maxBodySize: isUndefined(options.maxBodySize) ? undefined : parseBytes(options.maxBodySize),
    handlerTimeout: isUndefined(options.handlerTimeout)
      ? undefined
      : parseDuration(options.handlerTimeout),
    waitUntilTimeout: isUndefined(options.waitUntilTimeout)
      ? undefined
      : parseDuration(options.waitUntilTimeout),
  };
  const trustProxy = createCIDRMatcher(options.trustProxy ?? []);
  const allowedHosts = options.allowedHosts?.length
    ? createHostMatcher(options.allowedHosts)
    : undefined;
  const httpOptions: ServerOptions = {};
  if (!isUndefined(options.maxHeaderSize)) {
    httpOptions.maxHeaderSize = parseBytes(options.maxHeaderSize);
  }
  const server = createNodeServer(
    httpOptions,
    (req, res) => void handle(router, gate, limits, trustProxy, allowedHosts, req, res),
  );

  if (!isUndefined(options.headersTimeout))
    server.headersTimeout = parseDuration(options.headersTimeout);
  if (!isUndefined(options.requestTimeout))
    server.requestTimeout = parseDuration(options.requestTimeout);
  if (!isUndefined(options.keepAliveTimeout)) {
    server.keepAliveTimeout = parseDuration(options.keepAliveTimeout);
  }
  if (!isUndefined(options.maxConnections)) server.maxConnections = options.maxConnections;

  return { server, gate };
}

interface RequestLimits {
  maxBodySize: number | undefined;
  handlerTimeout: number | undefined;
  waitUntilTimeout: number | undefined;
}

async function handle(
  router: Router,
  gate: Gate,
  limits: RequestLimits,
  trustProxy: (ip: string) => boolean,
  allowedHosts: ((hostname: string) => boolean) | undefined,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const release = gate.enter();
  if (isNull(release)) {
    res.statusCode = 503;
    res.setHeader('Connection', 'close');
    res.end();
    return;
  }

  let drain: (() => Promise<void>) | undefined;
  try {
    const url = toURL(req, trustProxy);
    if (allowedHosts && !allowedHosts(url.hostname)) {
      const response = toResponse(new HTTPError(400, 'Bad Request'), {
        status: 400,
        headers: new Headers(),
      });
      await sendResponse(res, response);
      return;
    }

    const method = (req.method ?? 'GET').toUpperCase() as HTTPMethod;
    const match = router.match(method, url.pathname);

    const overrides = match.type === 'matched' ? routeLimits(match.route.handler) : undefined;
    const request = toRequest(req, {
      url,
      maxBodySize: limit(overrides?.maxBodySize, limits.maxBodySize),
    });

    if (match.type === 'matched') {
      const dispatched = await dispatch(match.route, request, url, match.params, {
        handlerTimeout: limit(overrides?.handlerTimeout, limits.handlerTimeout),
        waitUntilTimeout: limit(overrides?.waitUntilTimeout, limits.waitUntilTimeout),
        ip: clientIP(req, trustProxy),
      });
      drain = dispatched.drain;
      await sendResponse(res, dispatched.response);
    } else {
      await sendResponse(res, errorResponse(match));
    }
  } catch (error) {
    if (error instanceof HTTPError && !res.headersSent) {
      await sendResponse(res, toResponse(error, { status: error.status, headers: new Headers() }));
      return;
    }
    usePrinter().error(`request failed: ${reason(error)}`);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end();
    }
  } finally {
    if (drain) await drain();
    release();
  }
}

function errorResponse(match: Exclude<RouteMatch, { type: 'matched' }>): Response {
  const headers = new Headers();
  if (match.type === 'method-not-allowed') {
    headers.set('Allow', match.allow.join(', '));
    return toResponse(new HTTPError(405, 'Method Not Allowed'), { status: 405, headers });
  }
  return toResponse(new HTTPError(404, 'Not Found'), { status: 404, headers });
}

function limit(
  override: number | false | undefined,
  fallback: number | undefined,
): number | undefined {
  if (override === false) return undefined;
  return override ?? fallback;
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
