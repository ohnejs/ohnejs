import type { IncomingMessage, ServerResponse } from 'node:http';

import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { isArray, isNull, isUndefined } from '../../utils/index.ts';

/**
 * Bridges a Node `IncomingMessage` into a Web `Request`.
 *
 * The URL is assembled from the request target and the `Host` header.
 * The socket is plain HTTP, so the scheme is always `http` (TLS terminates in the proxy, out of core).
 * `GET` and `HEAD` are forced bodyless.
 * Every other method streams the body via `Readable.toWeb` with `duplex: 'half'`.
 * The body flows on demand with backpressure rather than buffering.
 *
 * This is the only inbound place Node internals are touched.
 */
export function toRequest(req: IncomingMessage): Request {
  const method = req.method ?? 'GET';
  const host = req.headers.host ?? 'localhost';
  const url = new URL(req.url ?? '/', `http://${host}`);

  const headers = new Headers();
  for (const name in req.headers) {
    const value = req.headers[name];
    if (isUndefined(value)) continue;
    if (isArray(value)) for (const part of value) headers.append(name, part);
    else headers.append(name, value);
  }

  const bodyless = method === 'GET' || method === 'HEAD';
  return new Request(url, {
    method,
    headers,
    body: bodyless ? null : Readable.toWeb(req),
    duplex: 'half',
  });
}

/**
 * Writes a Web `Response` back onto a Node `ServerResponse`.
 *
 * Status and headers are copied over, then the body is piped from `Readable.fromWeb`.
 * The pipe carries backpressure and destroys both ends on error.
 * A bodyless response (e.g. `204`) just ends the socket.
 *
 * This is the only outbound place Node internals are touched.
 */
export async function sendResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  res.setHeaders(response.headers);

  if (isNull(response.body)) {
    res.end();
    return;
  }

  await pipeline(Readable.fromWeb(response.body), res);
}
