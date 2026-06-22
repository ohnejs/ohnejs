import type { IncomingMessage, Server, ServerResponse } from 'node:http';

import { createServer as createNodeServer } from 'node:http';

import type { HTTPMethod, Gate } from '../../utils/index.ts';
import type { RouteMatch, Router } from './router.ts';

import { createGate, isNull } from '../../utils/index.ts';
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
 * Builds the HTTP transport for a route table.
 *
 * Each request takes a gate ticket, is matched, dispatched, and serialized.
 * The ticket is released once the response is written and its background work drains.
 * A request that arrives while the gate is closing is refused with `503` and a `Connection: close`.
 * A path that matches no route is a `404`; one that matches but not for the method is a `405` with `Allow`.
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
export function createServer(router: Router): HttpServer {
  const gate = createGate();
  const server = createNodeServer((req, res) => void handle(router, gate, req, res));
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
