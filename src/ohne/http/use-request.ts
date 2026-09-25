import { useEvent } from './use-event.ts';

/**
 * Returns the current request as the Web standard `Request`.
 * Shorthand for `useEvent().request`; valid only within a request.
 * Its `signal` aborts when the client goes away before the response finished.
 * It also aborts when a graceful shutdown stops waiting for the request.
 *
 * @example
 * ```ts
 * useRequest().method            // -> 'POST'
 * useRequest().headers.get('ct') // -> the header value
 * useRequest().signal.aborted    // -> true once the client went away
 * ```
 */
export function useRequest(): Request {
  return useEvent().request;
}
