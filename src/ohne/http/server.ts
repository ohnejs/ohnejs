import type { IncomingMessage, Server, ServerResponse } from 'node:http';

import { createServer as createNodeServer } from 'node:http';

import type { HTTPMethod, Gate } from '../../utils/index.ts';
import type { RouteMatch, Router } from './router.ts';

import { createGate, isNull, isUndefined, parseDuration } from '../../utils/index.ts';
import { usePrinter } from '../printer/use-printer.ts';
import { toRequest, sendResponse } from './adapter.ts';
import { dispatch } from './dispatch.ts';
import { HTTPError } from './http-error.ts';
import { toResponse } from './to-response.ts';

/**
 * A built HTTP server: the Node transport and the drain gate it admits requests through.
 */
export interface HttpServer {
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
export function createServer(router: Router, options: CreateServerOptions = {}): HttpServer {
  const gate = createGate();
  const server = createNodeServer((req, res) => void handle(router, gate, req, res));

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

async function handle(
  router: Router,
  gate: Gate,
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

  try {
    const request = toRequest(req);
    const url = new URL(request.url);
    const match = router.match(request.method as HTTPMethod, url.pathname);

    if (match.type === 'matched') {
      const { response, drain } = await dispatch(match.route, request, url, match.params);
      await sendResponse(res, response);
      await drain();
    } else {
      await sendResponse(res, errorResponse(match));
    }
  } catch (error) {
    usePrinter().error(`request failed: ${reason(error)}`);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end();
    }
  } finally {
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

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
