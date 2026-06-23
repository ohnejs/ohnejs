import type { RouteParams } from '../../utils/index.ts';
import type { MiddlewareKey } from '../middleware/known-middleware.ts';

/**
 * Extensible per-request context bag.
 * Empty by default; middleware and integrations fill it - auth session, locale, resolved user.
 * Reached anywhere in a request via `useEvent().context`.
 *
 * Augment it from a layer with `declare module 'ohne'`.
 *
 * @example
 * ```ts
 * declare module 'ohne' {
 *   interface EventContext {
 *     auth: Session
 *     locale: string
 *   }
 * }
 * ```
 */
export interface EventContext {}

/**
 * The mutable response the serializer reads after the handler returns.
 * A handler returns its value; status and headers are set here, out of band.
 */
export interface ResponseInit {
  /**
   * Status code the response is sent with.
   * Set it directly or through `setResponseStatus`.
   *
   * @default
   * 200
   */
  status: number;

  /**
   * Headers merged onto the response.
   * Mutate in place; the serializer copies them onto the outgoing response.
   */
  headers: Headers;
}

/**
 * One object per request, held in `AsyncLocalStorage` for the request's lifetime.
 * `useEvent` reaches it at any depth, which is what makes the composables ambient.
 *
 * The request and parsed URL are the inbound contract.
 * `response` and `context` are the outbound and cross-cutting state a handler or middleware writes to.
 */
export interface Event {
  /**
   * The inbound request, as the Web standard `Request`.
   */
  request: Request;

  /**
   * The request URL, parsed once.
   * Read `url.searchParams` for the query.
   */
  url: URL;

  /**
   * Params captured from the route pattern, keyed by name.
   * A `[id]` segment becomes `params.id`; a catch-all `[...path]` becomes `params.path`.
   */
  params: RouteParams;

  /**
   * Mutable response state the serializer reads once the handler returns.
   */
  response: ResponseInit;

  /**
   * The extensible per-request context bag.
   */
  context: EventContext;

  /**
   * Names of the middleware that have run for this request, in run order.
   * A handler reads it to see which middleware applied; the pipeline appends each as it runs.
   */
  appliedMiddleware: MiddlewareKey[];

  /**
   * Keep background work alive past the response.
   * The promise runs after the response is sent and holds the request's drain ticket until it settles.
   * Shutdown therefore waits for it.
   * A rejection is isolated and logged, never touching the sent response.
   *
   * @example
   * ```ts
   * export default defineHandler(async () => {
   *   const user = await createUser()
   *
   *   // Send a welcome email after the response is sent
   *   useEvent().waitUntil(sendWelcomeEmail(user))
   *
   *   return user
   * })
   * ```
   */
  waitUntil(promise: Promise<unknown>): void;
}
