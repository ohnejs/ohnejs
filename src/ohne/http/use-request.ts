import { useEvent } from './use-event.ts';

/**
 * Returns the current request as the Web standard `Request`.
 * Shorthand for `useEvent().request`; valid only within a request.
 *
 * @example
 * ```ts
 * useRequest().method            // -> 'POST'
 * useRequest().headers.get('ct') // -> the header value
 * await useRequest().json()      // -> the parsed body
 * ```
 */
export function useRequest(): Request {
  return useEvent().request;
}
