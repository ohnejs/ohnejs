import type { ResponseInit as EventResponse } from './event.ts';

import { isNullish, isString, isUndefined } from '../../utils/index.ts';
import { HTTPError } from './http-error.ts';

/**
 * Serializes a handler's return value into a Web `Response`.
 *
 * The value decides the shape.
 * `init` supplies status and headers, except for a verbatim `Response` and an `HTTPError`.
 * Those two carry their own status:
 *
 * - `Response` - returned as-is.
 * - `HTTPError` - JSON `{ statusCode, message, data? }` at the error's status.
 * - `null` / `undefined` - empty body; `204` unless a status was set.
 * - `string` - `text/html`.
 * - `ReadableStream` / `Uint8Array` / `ArrayBuffer` / `Blob` - streamed as `application/octet-stream`.
 * - anything else - JSON.
 *
 * A `content-type` already on `init.headers` is left untouched, so a handler or middleware can override it.
 */
export function toResponse(value: unknown, init: EventResponse): Response {
  if (value instanceof Response) return value;

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

function isBinary(value: unknown): value is ReadableStream | Uint8Array | ArrayBuffer | Blob {
  return (
    value instanceof ReadableStream ||
    value instanceof Uint8Array ||
    value instanceof ArrayBuffer ||
    value instanceof Blob
  );
}
