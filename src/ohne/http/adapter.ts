import type { IncomingMessage, ServerResponse } from 'node:http';

import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { isArray, isNull, isUndefined } from '../../utils/index.ts';
import { payloadTooLarge } from './http-error.ts';

/**
 * Bridges a Node `IncomingMessage` into a Web `Request`.
 *
 * The URL is assembled from the request target and the `Host` header.
 * The socket is plain HTTP, so the scheme is always `http` (TLS terminates in the proxy, out of core).
 * `GET` and `HEAD` are forced bodyless.
 * Every other method streams the body via `Readable.toWeb` with `duplex: 'half'`.
 * The body flows on demand with backpressure rather than buffering.
 *
 * When `maxBodySize` is set, an over-cap `Content-Length` throws `413` before any body is read.
 * The streamed body is metered too, so a chunked or under-reported body aborts mid-flight with `413`.
 * The thrown error is an `HTTPError`, so the pipeline maps it to a response.
 *
 * This is the only inbound place Node internals are touched.
 */
export function toRequest(req: IncomingMessage, maxBodySize?: number): Request {
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
  if (
    !bodyless &&
    !isUndefined(maxBodySize) &&
    Number(req.headers['content-length']) > maxBodySize
  ) {
    throw payloadTooLarge();
  }

  let body = bodyless ? null : (Readable.toWeb(req) as ReadableStream<Uint8Array>);
  if (!isNull(body) && !isUndefined(maxBodySize)) body = meterBody(body, maxBodySize);

  return new Request(url, { method, headers, body, duplex: 'half' });
}

function meterBody(body: ReadableStream<Uint8Array>, max: number): ReadableStream<Uint8Array> {
  let seen = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > max) throw payloadTooLarge();
        controller.enqueue(chunk);
      },
    }),
  );
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
