import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';

import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { isArray, isNull, isUndefined, unmapIP } from '../../utils/index.ts';
import { payloadTooLarge } from './http-error.ts';

/**
 * Options for `toRequest`.
 */
export interface ToRequestOptions {
  /**
   * Largest request body to accept, in bytes.
   * An over-cap `Content-Length` throws `413` before any body is read; an overrun aborts mid-stream.
   * Omitted leaves the body size unbounded.
   */
  maxBodySize?: number;

  /**
   * Tells whether the socket's immediate peer is a trusted proxy.
   * When it returns `true` for the peer, `X-Forwarded-Proto` and `X-Forwarded-Host` are honored.
   * Omitted, or `false` for the peer, ignores those headers and trusts only the socket.
   */
  trustProxy?: (ip: string) => boolean;
}

/**
 * Bridges a Node `IncomingMessage` into a Web `Request`.
 *
 * The URL is assembled from the request target and the `Host` header.
 * The scheme is `http`, since TLS terminates in the proxy (out of core).
 * `GET` and `HEAD` are forced bodyless.
 * Every other method streams the body via `Readable.toWeb` with `duplex: 'half'`.
 * The body flows on demand with backpressure rather than buffering.
 *
 * When the peer is a trusted proxy (`trustProxy`), `X-Forwarded-Proto` and `X-Forwarded-Host` are honored.
 * They override the scheme and host, so the URL reflects the original client request.
 * An untrusted peer's forwarding headers are ignored, closing the cache-poisoning and open-redirect gap.
 *
 * When `maxBodySize` is set, an over-cap `Content-Length` throws `413` before any body is read.
 * The streamed body is metered too, so a chunked or under-reported body aborts mid-flight with `413`.
 * The thrown error is an `HTTPError`, so the pipeline maps it to a response.
 *
 * This is the only inbound place Node internals are touched.
 */
export function toRequest(req: IncomingMessage, options: ToRequestOptions = {}): Request {
  const method = req.method ?? 'GET';
  const forwarded = trusts(options.trustProxy, req) ? forwardedOrigin(req.headers) : undefined;
  const host = forwarded?.host ?? req.headers.host ?? 'localhost';
  const proto = forwarded?.proto ?? 'http';
  const url = new URL(req.url ?? '/', `${proto}://${host}`);

  const headers = new Headers();
  for (const name in req.headers) {
    const value = req.headers[name];
    if (isUndefined(value)) continue;
    if (isArray(value)) for (const part of value) headers.append(name, part);
    else headers.append(name, value);
  }

  const { maxBodySize } = options;
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

/**
 * Resolves the client IP behind any trusted proxies.
 *
 * When the socket's peer is a trusted proxy (`trustProxy`), the real client comes from `X-Forwarded-For`.
 * Walking it right-to-left, the first address that is not itself a trusted proxy is the client.
 * Otherwise, or when every forwarded entry is trusted, the socket's own peer address is the client.
 * The result is normalized, so an IPv4-mapped IPv6 peer reads as plain IPv4.
 *
 * This reads the Node socket, so it lives in the adapter with the other inbound bridging.
 */
export function clientIP(req: IncomingMessage, trustProxy?: (ip: string) => boolean): string {
  const peer = req.socket.remoteAddress ?? '';
  if (isUndefined(trustProxy) || !trustProxy(peer)) return unmapIP(peer);

  const forwarded = forwardedFor(req.headers);
  for (let i = forwarded.length - 1; i >= 0; i--) {
    if (!trustProxy(forwarded[i])) return unmapIP(forwarded[i]);
  }
  return unmapIP(peer);
}

function trusts(trustProxy: ToRequestOptions['trustProxy'], req: IncomingMessage): boolean {
  return !isUndefined(trustProxy) && trustProxy(req.socket.remoteAddress ?? '');
}

function forwardedFor(headers: IncomingHttpHeaders): string[] {
  const value = headers['x-forwarded-for'];
  if (isUndefined(value)) return [];
  const raw = isArray(value) ? value.join(',') : value;
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function forwardedOrigin(headers: IncomingHttpHeaders): { proto?: string; host?: string } {
  return {
    proto: firstToken(headers['x-forwarded-proto']),
    host: firstToken(headers['x-forwarded-host']),
  };
}

function firstToken(value: string | string[] | undefined): string | undefined {
  if (isUndefined(value)) return undefined;
  const raw = isArray(value) ? value[0] : value;
  const token = raw?.split(',')[0]?.trim();
  return token ? token : undefined;
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
