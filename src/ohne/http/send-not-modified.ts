import { useEvent } from './use-event.ts';

/**
 * Answers `304 Not Modified`: sets the status so the empty body serializes at `304`.
 * Writes `useEvent().response`; valid only within a request.
 *
 * The handler returns nothing after calling this.
 * The `ETag` / `Last-Modified` already on the response are preserved, as a `304` should carry them.
 *
 * @example
 * ```ts
 * useResponse().headers.set('etag', etag(body))
 * if (isFresh()) return sendNotModified()
 * return body
 * ```
 */
export function sendNotModified(): void {
  useEvent().response.status = 304;
}
