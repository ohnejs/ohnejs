import type { RouteParams } from '../../utils/index.ts';
import type { MiddlewareKey } from '../middleware/known-middleware.ts';
import type { Handler, Route } from '../routes/route.ts';
import type { Event } from './event.ts';

import { isUndefined, withTimeout } from '../../utils/index.ts';
import { applyHook } from '../hooks/apply-hook.ts';
import { useHooks } from '../hooks/use-hooks.ts';
import { useMiddleware } from '../middleware/use-middleware.ts';
import { usePrinter } from '../printer/use-printer.ts';
import { HTTPError } from './http-error.ts';
import { toResponse } from './to-response.ts';
import { runWithEvent } from './use-event.ts';

/**
 * The outcome of running a matched route.
 * The response is ready to send; `drain` settles the request's background work.
 */
export interface Dispatched {
  /**
   * The response to write back to the client.
   */
  response: Response;

  /**
   * Awaits every `waitUntil` promise, isolating and logging rejections.
   * The transport calls it after the response is sent, then releases the drain ticket.
   * Newly registered work is drained too, so a `waitUntil` that calls `waitUntil` still settles.
   */
  drain(): Promise<void>;
}

/**
 * Per-dispatch inputs applied around the handler run.
 */
export interface DispatchOptions {
  /**
   * Milliseconds to let middleware and the handler run before giving up with a `503`.
   * Distinct from the socket-level `requestTimeout`: this bounds the work, not the connection.
   * Omitted lets the handler run without a deadline.
   */
  handlerTimeout?: number;

  /**
   * The resolved client IP, exposed as `event.ip`.
   * Omitted leaves `event.ip` an empty string, meaning the transport could not resolve one.
   */
  ip?: string;
}

/**
 * Runs a matched route to a response.
 *
 * Builds the request `Event` and binds it via `runWithEvent`.
 * The `middleware:resolve` hook may filter or reorder the middleware first.
 * Runs the resolved middleware in order, recording each on `event.appliedMiddleware`, then the handler.
 * A middleware that returns a value short-circuits, and the handler never runs.
 * A returned or thrown `HTTPError` maps to its status.
 * Any other throw becomes a `500` with the real error logged, never sent.
 * When `handlerTimeout` is set and the run overruns it, the response is a `503` and the work is abandoned.
 * The returned `drain` defers background work past the response.
 *
 * @example
 * ```ts
 * const { response, drain } = await dispatch(route, request, url, params)
 * await sendResponse(res, response)
 * await drain()
 * ```
 */
export async function dispatch(
  route: Route,
  request: Request,
  url: URL,
  params: RouteParams,
  options: DispatchOptions = {},
): Promise<Dispatched> {
  const background: Promise<unknown>[] = [];

  const event: Event = {
    request,
    url,
    params,
    ip: options.ip ?? '',
    response: { status: 200, headers: new Headers() },
    context: {},
    appliedMiddleware: [],
    waitUntil(promise) {
      background.push(promise);
    },
  };

  const run = runWithEvent(event, async () => {
    try {
      const registry = useMiddleware();
      for (const name of await resolveMiddleware(registry.keys(), event)) {
        event.appliedMiddleware.push(name as MiddlewareKey);
        const result = await registry.get(name)!(event);
        if (!isUndefined(result)) return toResponse(result, event.response);
      }
      const result = await (route.handler as Handler)({ params });
      return toResponse(result, event.response);
    } catch (error) {
      if (error instanceof HTTPError) return toResponse(error, event.response);
      logUnhandled(route, error);
      return toResponse(new HTTPError(500, 'Internal Server Error'), event.response);
    }
  });

  const response = isUndefined(options.handlerTimeout)
    ? await run
    : await withTimeout(run, options.handlerTimeout, () =>
        toResponse(new HTTPError(503, 'Service Unavailable'), {
          status: 503,
          headers: new Headers(),
        }),
      );

  return { response, drain: () => drain(background) };
}

async function resolveMiddleware(names: string[], event: Event): Promise<string[]> {
  const callbacks = useHooks().get('middleware:resolve');
  if (isUndefined(callbacks) || callbacks.length === 0) return names;
  return applyHook('middleware:resolve', names as MiddlewareKey[], event);
}

async function drain(background: Promise<unknown>[]): Promise<void> {
  while (background.length > 0) {
    const batch = background.splice(0);
    for (const result of await Promise.allSettled(batch)) {
      if (result.status === 'rejected') {
        usePrinter().error(`waitUntil rejected: ${reason(result.reason)}`);
      }
    }
  }
}

function logUnhandled(route: Route, error: unknown): void {
  usePrinter().errorBlock({
    title: `Unhandled error in ${route.method ?? 'ANY'} ${route.pattern}`,
    body: error instanceof Error ? (error.stack ?? error.message) : reason(error),
  });
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
