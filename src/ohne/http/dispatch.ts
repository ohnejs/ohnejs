import type { RouteParams } from '../../utils/index.ts';
import type { MiddlewareKey } from '../middleware/known-middleware.ts';
import type { Handler, Route } from '../routes/route.ts';
import type { Event, EventContext } from './event.ts';

import {
  coerceToNumber,
  errorMessage,
  isNull,
  isNumber,
  isUndefined,
  withTimeout,
} from '../../utils/index.ts';
import { applyHook } from '../hooks/apply-hook.ts';
import { useHooks } from '../hooks/use-hooks.ts';
import { useMiddleware } from '../middleware/use-middleware.ts';
import { usePrinter } from '../printer/use-printer.ts';
import { isBusyError } from '../query/write/busy.ts';
import { isReferenceViolation, isValidationError } from '../query/write/errors.ts';
import { conflict, HTTPError, payloadTooLarge, unprocessable } from './http-error.ts';
import { routeMiddleware } from './route-middleware.ts';
import { toResponse } from './to-response.ts';
import { resolveMessage, translate } from './translate.ts';
import { runWithEvent } from './use-event.ts';

declare module 'ohnejs' {
  interface Hooks {
    /**
     * Filters a handler's raw return value before it serializes into a `Response`.
     * Fires for a handler result and for a middleware short-circuit, each before `toResponse` runs.
     * Return a replacement value - an envelope, a DTO, a redacted copy - or mutate it and return nothing.
     * The replacement serializes by the handler-return rules: a `Response`, `HTTPError`, string, or JSON.
     * Returning `undefined` leaves the value unchanged, so a callback cannot force a `204` from nothing.
     * It runs inside the request context, so the passed `event` and the composables both reach the request.
     * A returned `HTTPError` lands here like any value; a thrown error goes to `error:response` instead.
     */
    'handler:result': (result: unknown, event: Event) => unknown;

    /**
     * Filters the finished response of a dispatched request, just before it returns to the transport.
     * Fires for every outcome: a handler result, a middleware short-circuit, or a mapped `HTTPError`.
     * The generic `500` and the timed-out `503` run through it too.
     * Return a replacement `Response`, or mutate `response.headers` in place and return nothing.
     * Returning `undefined` leaves the response unchanged.
     * It runs outside the request context, so read the passed `event`, not the composables.
     * Router misses (`404`/`405`) skip dispatch; reach for `response:headers` to cover those too.
     */
    'response:send': (
      response: Response,
      event: Event,
    ) => void | Response | Promise<void | Response>;

    /**
     * Filters the response built when a request throws, inside the request context.
     * Fires for a mapped `HTTPError` and for an unhandled error's generic `500`.
     * A non-throwing timeout `503` is not an error outcome, so it does not fire.
     * Receives the error response, the thrown `error`, and the `Event`.
     * Return a replacement `Response`: a branded error page, or a body with the detail redacted.
     * Otherwise report the error and return nothing to leave it unchanged.
     * It runs before `response:send`, which then sees whatever this returns.
     */
    'error:response': (
      response: Response,
      error: unknown,
      event: Event,
    ) => void | Response | Promise<void | Response>;
  }
}

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
   * The request `Event`, surfaced so the transport can fire `request:complete` once the request ends.
   */
  event: Event;

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
   * Largest request body to accept, in bytes.
   * An over-cap `Content-Length` is refused with `413` after the middleware, before the handler.
   * The response headers the middleware set, a CORS policy's among them, ride along on the refusal.
   * Omitted skips the check.
   */
  maxBodySize?: number;

  /**
   * Milliseconds to let middleware and the handler run before giving up with a `503`.
   * Distinct from the socket-level `requestTimeout`: this bounds the work, not the connection.
   * Omitted lets the handler run without a deadline.
   */
  handlerTimeout?: number;

  /**
   * Milliseconds to let a `waitUntil` promise run after the response before abandoning it.
   * On overrun the promise is logged and the request's drain ticket is released.
   * Omitted lets background work run without a deadline.
   */
  waitUntilTimeout?: number;

  /**
   * The resolved client IP, exposed as `event.ip`.
   * Omitted means the transport could not resolve one.
   *
   * @default
   * ''
   */
  ip?: string;
}

/**
 * Runs a matched route to a response.
 *
 * Builds the request `Event` and binds it via `runWithEvent`.
 * Runs the global middleware, then the route's selected named middleware.
 * The `middleware:resolve` hook may filter or reorder that combined list first.
 * Records each on `event.appliedMiddleware` as it runs, then runs the handler.
 * A middleware that returns a value short-circuits, and the handler never runs.
 * When `maxBodySize` is set, an over-cap `Content-Length` is refused with `413` before the handler runs.
 * A returned or thrown `HTTPError` maps to its status.
 * A write that fails validation, hits a busy database, or is blocked by a reference maps to its own status.
 * Any other throw becomes a `500` with the real error logged, never sent.
 * When `handlerTimeout` is set and the run overruns it, the response is a `503` and the work is abandoned.
 * A thrown error runs the `error:response` hook first.
 * `response:send` then filters the final response of every outcome, the timeout `503` included.
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
  const { waitUntilTimeout } = options;

  const event: Event = {
    request,
    url,
    params,
    ip: options.ip ?? '',
    response: { status: 200, headers: new Headers() },
    context: {} as EventContext,
    appliedMiddleware: [],
    waitUntil(promise) {
      // A rejection deferred to drain leaks an unhandledRejection before the response is sent.
      const bounded = isUndefined(waitUntilTimeout)
        ? promise
        : withTimeout(promise, waitUntilTimeout, () => {
            usePrinter().error(
              `\`waitUntil\` timed out after ${waitUntilTimeout}ms in \`${route.method ?? 'ANY'} ${route.pattern}\``,
            );
          });
      background.push(
        bounded.catch((error: unknown) => {
          usePrinter().error(`\`waitUntil\` rejected: ${errorMessage(error)}`);
        }),
      );
    },
  };

  const run = runWithEvent(event, async () => {
    try {
      const registry = useMiddleware();
      const selected = routeMiddleware(route.handler, registry.namedKeys());
      const base = [...registry.globalKeys(), ...selected];
      for (const name of await resolveMiddleware(base, event)) {
        event.appliedMiddleware.push(name as MiddlewareKey);
        const result = await registry.get(name)!(event);
        if (!isUndefined(result))
          return toResponse(await resolveResult(result, event), event.response);
      }
      if (exceedsBodySize(request, options.maxBodySize)) throw payloadTooLarge();
      const result = await (route.handler as Handler)({ params });
      return toResponse(await resolveResult(result, event), event.response);
    } catch (error) {
      if (isValidationError(error)) {
        // A field path may be `__proto__`/`constructor`/`prototype`, which `mapValues` drops; keep them all.
        const errors: Record<string, string> = Object.create(null);
        for (const path of Object.keys(error.errors))
          errors[path] = resolveMessage(error.errors[path]);
        const http = unprocessable(undefined, { errors });
        return resolveErrorResponse(toResponse(http, event.response), http, event);
      }
      if (isBusyError(error)) {
        const http = new HTTPError(503, translate('api.http.serviceUnavailable'));
        const response = toResponse(http, event.response);
        response.headers.set('Retry-After', '1');
        return resolveErrorResponse(response, http, event);
      }
      if (isReferenceViolation(error)) {
        const http = conflict();
        return resolveErrorResponse(toResponse(http, event.response), http, event);
      }
      if (error instanceof HTTPError) {
        return resolveErrorResponse(toResponse(error, event.response), error, event);
      }
      logUnhandled(route, error);
      const response = toResponse(
        new HTTPError(500, translate('api.http.internalServerError')),
        event.response,
      );
      return resolveErrorResponse(response, error, event);
    }
  });

  const response = isUndefined(options.handlerTimeout)
    ? await run
    : await withTimeout(run, options.handlerTimeout, () =>
        toResponse(new HTTPError(503, translate('api.http.serviceUnavailable')), {
          status: 503,
          headers: new Headers(),
        }),
      );

  return {
    response: await resolveResponse(response, event),
    event,
    drain: () => drain(background),
  };
}

/**
 * Runs the `middleware:resolve` hook over `names`, or returns them as-is when nothing listens.
 */
async function resolveMiddleware(names: string[], event: Event): Promise<string[]> {
  const callbacks = useHooks().get('middleware:resolve');
  if (isUndefined(callbacks) || callbacks.length === 0) return names;
  return applyHook('middleware:resolve', names as MiddlewareKey[], event);
}

/**
 * Runs the `response:send` hook over `response`, or returns it as-is when nothing listens.
 */
async function resolveResponse(response: Response, event: Event): Promise<Response> {
  const callbacks = useHooks().get('response:send');
  if (isUndefined(callbacks) || callbacks.length === 0) return response;
  return applyHook('response:send', response, event);
}

/**
 * Runs the `handler:result` hook over `result`, or returns it as-is when nothing listens.
 */
async function resolveResult(result: unknown, event: Event): Promise<unknown> {
  const callbacks = useHooks().get('handler:result');
  if (isUndefined(callbacks) || callbacks.length === 0) return result;
  return applyHook('handler:result', result, event);
}

/**
 * Runs the `error:response` hook over `response`, or returns it as-is when nothing listens.
 */
async function resolveErrorResponse(
  response: Response,
  error: unknown,
  event: Event,
): Promise<Response> {
  const callbacks = useHooks().get('error:response');
  if (isUndefined(callbacks) || callbacks.length === 0) return response;
  return applyHook('error:response', response, error, event);
}

/**
 * Whether the declared `Content-Length` exceeds `max`; `false` without a body, a cap, or a numeric length.
 */
function exceedsBodySize(request: Request, max: number | undefined): boolean {
  if (isNull(request.body) || isUndefined(max)) return false;
  const length = coerceToNumber(request.headers.get('content-length'));
  return isNumber(length) && length > max;
}

/**
 * Awaits the background work until none is left, so work registered while draining settles too.
 */
async function drain(background: Promise<unknown>[]): Promise<void> {
  while (background.length > 0) await Promise.all(background.splice(0));
}

/**
 * Prints an unhandled route error as a block titled by the route, with the stack under `DEBUG`.
 */
function logUnhandled(route: Route, error: unknown): void {
  const printer = usePrinter();
  printer.errorBlock({
    title: `Unhandled error in \`${route.method ?? 'ANY'} ${route.pattern}\``,
    body: errorMessage(error),
  });
  if (error instanceof Error && !isUndefined(error.stack)) printer.debug(error.stack);
}
