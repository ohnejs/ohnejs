import type { IncomingMessage, Server, ServerResponse } from 'node:http';

import { createServer as createNodeServer } from 'node:http';

import type { Gate, HTTPMethod } from '../../utils/index.ts';
import type { RouteMatch, Router } from './router.ts';

import {
  createCIDRMatcher,
  createGate,
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
   * Omitted keeps Node's default.
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
   * Omitted keeps Node's default.
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
   * Omitted keeps Node's default.
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
  };
  const trustProxy = createCIDRMatcher(options.trustProxy ?? []);
  const server = createNodeServer(
    (req, res) => void handle(router, gate, limits, trustProxy, req, res),
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
}

async function handle(
  router: Router,
  gate: Gate,
  limits: RequestLimits,
  trustProxy: (ip: string) => boolean,
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
