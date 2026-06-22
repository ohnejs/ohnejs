import type { RouteParams } from '../../utils/index.ts';
import type { Handler, Route } from '../routes/route.ts';
import type { Event } from './event.ts';

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
 * Runs a matched route to a response.
 *
 * Builds the request `Event`, binds it via `runWithEvent`, runs the handler, and serializes its return.
 * A returned or thrown `HTTPError` maps to its status.
 * Any other throw becomes a `500` with the real error logged, never sent.
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
): Promise<Dispatched> {
  const background: Promise<unknown>[] = [];

  const event: Event = {
    request,
    url,
    params,
    response: { status: 200, headers: new Headers() },
    context: {},
    waitUntil(promise) {
      background.push(promise);
    },
  };

  const response = await runWithEvent(event, async () => {
    try {
      const result = await (route.handler as Handler)({ params });
      return toResponse(result, event.response);
    } catch (error) {
      if (error instanceof HTTPError) return toResponse(error, event.response);
      logUnhandled(route, error);
      return toResponse(new HTTPError(500, 'Internal Server Error'), event.response);
    }
  });

  return { response, drain: () => drain(background) };
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
