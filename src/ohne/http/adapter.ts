import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';

import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { first, isArray, isNull, isUndefined } from '../../utils/index.ts';
import { unmapIP } from '../../utils/net/index.ts';
import { applyHook } from '../hooks/apply-hook.ts';
import { useHooks } from '../hooks/use-hooks.ts';
import { payloadTooLarge } from './http-error.ts';

declare module 'ohnejs' {
  interface Hooks {
    /**
     * Filters a response's outgoing headers, the last seam before they are written to the socket.
     * Unlike `response:send`, it also covers responses that never enter dispatch.
     * A router `404`/`405`, a rejected-host `400`, and a base-path miss all pass through here.
     * Receives the headers and the read-only `Response` for status context.
     * Stamp or strip a header in place and return nothing, or return a replacement `Headers`.
     * Returning `undefined` leaves them unchanged.
     */
    'response:headers': (
      headers: Headers,
      response: Response,
    ) => void | Headers | Promise<void | Headers>;
  }
}

/**
 * Options for `toRequest`.
 */
export interface ToRequestOptions {
  /**
   * The request URL, already assembled.
   * Omitted, it is built from the request via `toURL`, without proxy trust.
   * The transport passes the URL it routed on; a standalone caller can let `toRequest` build one.
   */
  url?: URL;

  /**
   * Largest request body to accept, in bytes.
   * The streamed body is metered, so an overrun aborts mid-flight with `413`.
   * The `Content-Length` pre-check lives in `dispatch`, after the middleware.
   * Omitted leaves the body size unbounded.
   */
  maxBodySize?: number;
}

/**
 * Assembles the request `URL` from the target and the resolved `Host`.
 *
 * The scheme is `http`, since TLS terminates in the proxy (out of core).
 * When the peer is a trusted proxy (`trustProxy`), the forwarding headers override the scheme and host.
 * The URL then reflects the original client request, not the proxy hop.
 * Only `X-Forwarded-Proto` and `X-Forwarded-Host` are read; the `Forwarded` header is not consulted.
 * An untrusted peer's forwarding headers are ignored, closing the cache-poisoning and open-redirect gap.
 *
 * The transport assembles the URL before routing, then hands it to `toRequest`, so the body is built once.
 */
export function toURL(req: IncomingMessage, trustProxy?: (ip: string) => boolean): URL {
  const forwarded = trusts(trustProxy, req) ? forwardedOrigin(req.headers) : undefined;
  const host = forwarded?.host ?? req.headers.host ?? 'localhost';
  const proto = forwarded?.proto ?? 'http';
  return new URL(req.url ?? '/', `${proto}://${host}`);
}

/**
 * Bridges a Node `IncomingMessage` into a Web `Request`.
 * The URL comes from `options.url`, or is assembled from the request via `toURL` when omitted.
 *
 * `GET` and `HEAD` are forced bodyless.
 * Every other method streams the body via `Readable.toWeb` with `duplex: 'half'`.
 * The body flows on demand with backpressure rather than buffering.
 *
 * When `maxBodySize` is set, the streamed body is metered, so an overrun aborts mid-flight with `413`.
 * The thrown error is an `HTTPError`, so the pipeline maps it to a response.
 * The `Content-Length` pre-check lives in `dispatch`, so a policy middleware's headers reach the `413`.
 *
 * This is the only inbound place Node internals are touched.
 */
export function toRequest(req: IncomingMessage, options: ToRequestOptions = {}): Request {
  const url = options.url ?? toURL(req);
  const method = (req.method ?? 'GET').toUpperCase();

  const headers = new Headers();
  for (const name in req.headers) {
    const value = req.headers[name];
    if (isUndefined(value)) continue;
    if (isArray(value)) for (const part of value) headers.append(name, part);
    else headers.append(name, value);
  }

  const { maxBodySize } = options;
  const bodyless = method === 'GET' || method === 'HEAD';
  let body = bodyless ? null : (Readable.toWeb(req) as ReadableStream<Uint8Array>);
  if (!isNull(body) && !isUndefined(maxBodySize)) body = meterBody(body, maxBodySize);

  return new Request(url, { method, headers, body, duplex: 'half' });
}

/**
 * Resolves the client IP behind any trusted proxies.
 *
 * When the socket's peer is a trusted proxy (`trustProxy`), the real client comes from `X-Forwarded-For`.
 * Walking it right-to-left, the first address that is not itself a trusted proxy is the client.
 * When every forwarded entry is trusted, or the peer is untrusted, the socket's own peer address is used.
 * The result is normalized, so an IPv4-mapped IPv6 peer reads as plain IPv4.
 *
 * The RFC 7239 `Forwarded` header is not consulted.
 * A proxy that forwards a client-supplied one could otherwise be spoofed.
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

function trusts(trustProxy: ((ip: string) => boolean) | undefined, req: IncomingMessage): boolean {
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
  const raw = isArray(value) ? first(value) : value;
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
 * The `response:headers` hook filters the headers before they are written.
 * The open CORS default is then applied, unless a policy already set or denied an origin.
 * The pipe carries backpressure and destroys both ends on error.
 * A bodyless response (e.g. `204`) just ends the socket.
 *
 * This is the only outbound place Node internals are touched.
 */
export async function sendResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  res.setHeaders(await resolveHeaders(response, res.req.method));

  if (isNull(response.body)) {
    res.end();
    return;
  }

  try {
    await pipeline(Readable.fromWeb(response.body), res);
  } catch (error) {
    const clientLeft =
      (error as NodeJS.ErrnoException).code === 'ERR_STREAM_PREMATURE_CLOSE' && res.req.destroyed;
    if (!clientLeft) throw error;
  }
}

async function resolveHeaders(response: Response, method?: string): Promise<Headers> {
  const callbacks = useHooks().get('response:headers');
  const headers =
    isUndefined(callbacks) || callbacks.length === 0
      ? response.headers
      : await applyHook('response:headers', response.headers, response);
  applyDefaultCORS(headers, method);
  return headers;
}

/**
 * Applies the open CORS default to a finished response, last of all.
 * A response that already allows an origin is left alone, so a configured `cors` always wins.
 * So is one carrying `Vary: Origin`: a `cors` varied on the origin and chose to deny it.
 * Otherwise the API allows any origin, and any method and header on a preflight.
 */
function applyDefaultCORS(headers: Headers, method?: string): void {
  if (headers.has('access-control-allow-origin') || variesOnOrigin(headers)) return;
  headers.set('access-control-allow-origin', '*');
  if (method === 'OPTIONS') {
    headers.set('access-control-allow-methods', '*');
    headers.set('access-control-allow-headers', '*');
  }
}

function variesOnOrigin(headers: Headers): boolean {
  const vary = headers.get('vary');
  return (
    !isNull(vary) &&
    vary
      .toLowerCase()
      .split(',')
      .some((token) => token.trim() === 'origin')
  );
}
