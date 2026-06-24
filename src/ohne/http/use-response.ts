import type { ResponseInit } from './event.ts';

import { useEvent } from './use-event.ts';

/**
 * Returns the mutable response state the serializer reads after the handler returns.
 * Shorthand for `useEvent().response`; valid only within a request.
 *
 * Mutate it in place: assign `status`, and `set` / `append` / `delete` on `headers`.
 * The handler still returns its value as the body; this only shapes status and headers.
 *
 * @example
 * ```ts
 * useResponse().status = 201
 * useResponse().headers.set('cache-control', 'no-store')
 * useResponse().headers.append('set-cookie', 'sid=abc; HttpOnly')
 * ```
 */
export function useResponse(): ResponseInit {
  return useEvent().response;
}
