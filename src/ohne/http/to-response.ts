import type { ResponseInit as EventResponse } from './event.ts';

import { isNullish, isString, isUndefined, vary } from '../../utils/index.ts';
import { HTTPError } from './http-error.ts';

/**
 * Serializes a handler's return value into a Web `Response`.
 *
 * The value decides the shape.
 * `init` supplies status and headers, but a verbatim `Response` and an `HTTPError` carry their own status:
 *
 * - `Response` - its own status and body win; `init` headers are merged in, the Response winning per name.
 * - `HTTPError` - JSON `{ statusCode, message, data? }` at the error's status.
 * - `null` / `undefined` - empty body; `204` unless a status was set.
 * - `string` - `text/html`.
 * - `ReadableStream` / `Uint8Array` / `ArrayBuffer` / `Blob` - streamed as `application/octet-stream`.
 * - anything else - JSON.
 *
 * A `content-type` already on `init.headers` is left untouched, so a handler or middleware can override it.
 */
export function toResponse(value: unknown, init: EventResponse): Response {
  if (value instanceof Response) return mergeHeaders(value, init.headers);

  const { status, headers } = init;

  if (value instanceof HTTPError) {
    if (!headers.has('content-type'))
      headers.set('content-type', 'application/json; charset=utf-8');
    const body = isUndefined(value.data)
      ? { statusCode: value.status, message: value.message }
      : { statusCode: value.status, message: value.message, data: value.data };
    return new Response(JSON.stringify(body), { status: value.status, headers });
  }

  if (isNullish(value))
    return new Response(null, { status: status === 200 ? 204 : status, headers });

  if (isString(value)) {
    if (!headers.has('content-type')) headers.set('content-type', 'text/html; charset=utf-8');
    return new Response(value, { status, headers });
  }

  if (isBinary(value)) {
    if (!headers.has('content-type')) headers.set('content-type', 'application/octet-stream');
    return new Response(value, { status, headers });
  }

  if (!headers.has('content-type')) headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(value), { status, headers });
}

/**
 * Merges `extra` onto a verbatim `Response`, the Response winning per name.
 * `vary` is unioned and `set-cookie` accumulates, so a verbatim Response cannot drop a negotiated `Vary`.
 * Rebuilds rather than mutating in place: a `Response.redirect()` carries immutable headers.
 */
function mergeHeaders(response: Response, extra: Headers): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of extra) {
    if (name === 'set-cookie' || name === 'vary') continue;
    if (!headers.has(name)) headers.set(name, value);
  }
  const merged = vary(headers.get('vary') ?? '', extra.get('vary') ?? '');
  if (merged !== '') headers.set('vary', merged);
  for (const cookie of extra.getSetCookie()) headers.append('set-cookie', cookie);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Whether `value` passes to `Response` as raw bytes rather than serializing to JSON.
 */
function isBinary(value: unknown): value is ReadableStream | Uint8Array | ArrayBuffer | Blob {
  return (
    value instanceof ReadableStream ||
    value instanceof Uint8Array ||
    value instanceof ArrayBuffer ||
    value instanceof Blob
  );
}
