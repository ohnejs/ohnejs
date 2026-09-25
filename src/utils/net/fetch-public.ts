import type { ClientRequest, IncomingMessage } from 'node:http';
import type { RequestOptions } from 'node:https';

import { Resolver } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { urlToHttpOptions } from 'node:url';

import type { FetchPublicError } from './_fetch-public-error.ts';

import { isUndefined } from '../is/is-undefined.ts';
import { limitStream } from '../stream/limit-stream.ts';
import { longTimeout } from '../timeout/long-timeout.ts';
import { isFetchableURL } from '../uri/is-fetchable-url.ts';
import { fetchPublicError, isFetchPublicError } from './_fetch-public-error.ts';
import { createAdmit, guardedLookup } from './_guard.ts';
import { nextHop } from './_hop.ts';

export { isFetchPublicError } from './_fetch-public-error.ts';
export type { FetchPublicError, FetchPublicErrorCode } from './_fetch-public-error.ts';

/**
 * Options for `fetchPublic`.
 */
export interface FetchPublicOptions {
  /**
   * Addresses and CIDR blocks reached although not public, on any port.
   * The escape hatch for an intranet, and the way a test reaches `127.0.0.1`.
   *
   * @default
   * []
   */
  allow?: string[];

  /**
   * Largest body in bytes.
   * A larger declared `Content-Length` fails before the body; a body that streams past it errors.
   *
   * @default
   * Infinity
   */
  maxBytes?: number;

  /**
   * Total deadline in milliseconds, across every redirect and the whole body.
   *
   * @default
   * 60000
   */
  timeout?: number;

  /**
   * Aborts the fetch at any point, the body included.
   */
  signal?: AbortSignal;

  /**
   * DNS servers to resolve through, in the form `Resolver.setServers` takes.
   * Omitted resolves through the system's servers.
   */
  servers?: string[];

  /**
   * The `User-Agent` header to send.
   * Omitted sends none.
   */
  userAgent?: string;
}

/**
 * The final `200` response of a `fetchPublic`, its body still unread.
 */
export interface PublicResponse {
  /**
   * The URL that answered, after every redirect.
   */
  url: URL;

  /**
   * The final response's headers.
   */
  headers: Headers;

  /**
   * The declared `Content-Length`, exact since Node's parser enforces it.
   * Absent for a chunked body.
   */
  size?: number;

  /**
   * The body, capped at `maxBytes` and bound by the deadline.
   * It errors with a `FetchPublicError`.
   * Cancel it when you will not read it, so the connection closes at once.
   */
  body: ReadableStream<Uint8Array>;
}

/**
 * What every hop of one fetch shares.
 */
interface Session {
  admits: (port: number) => (ip: string) => boolean;
  resolver: Resolver;
  headers: Record<string, string>;
  signal: AbortSignal;
  onIdle: () => void;
}

const MAX_REDIRECTS = 5;

/**
 * Deadline for the response head, across the whole redirect chain.
 */
const HEADERS_TIMEOUT = 30_000;

/**
 * Longest silence from the remote while waiting on it, from connect to the last body byte.
 */
const IDLE_TIMEOUT = 30_000;

/**
 * Largest response head in bytes, pinned per request so `--max-http-header-size` cannot raise it.
 */
const MAX_HEADER_SIZE = 16 * 1024;

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

const DEFAULT_PORTS: Record<string, number> = { 'http:': 80, 'https:': 443 };

/**
 * GETs `url` while connecting only to public addresses, and resolves the final `200` with its body unread.
 * Built to fetch a URL someone else chose without reaching the host, its network, or cloud metadata.
 *
 * Each hop is vetted where it connects, so a rebinding name cannot swap its answer after the check.
 * - A literal address is checked before the request, since `net` never looks one up.
 * - A name resolves once per connection, and one refused address refuses the whole answer.
 * - Only the first address of each family is dialed, so a long answer cannot scan a network.
 * - An address is admitted when `allow` holds it, on any port.
 * - Any other must pass `isPublicIP` on port 80 or 443, and lie off the host's own networks.
 * - A platform address, such as Azure's wire server, is refused although it is public.
 *
 * The exchange stays narrow.
 * - Every hop is a fresh unpooled socket, never an environment proxy.
 * - Only fixed headers are sent, and `https:` always verifies the certificate.
 * - The response parser stays strict and caps the head at 16 KiB, whatever flags the process runs with.
 * - Redirects are followed by hand, and each target is vetted like the first URL.
 * - A drop from `https:` to `http:` is refused.
 * - Only a `200` succeeds.
 * - The body must arrive unencoded and framed by `Content-Length` or chunked, so truncation always shows.
 *
 * Failures are `FetchPublicError`s whose message never names a URL, host, or address.
 * `invalid` only ever describes the input URL.
 *
 * @example
 * ```ts
 * const { url, headers, size, body } = await fetchPublic('https://example.com/photo.jpg', {
 *   maxBytes: 10_000_000,
 *   userAgent: 'ohne',
 * })
 *
 * await fetchPublic('http://169.254.169.254/latest/meta-data/')
 * // -> rejects with code 'refused'
 * ```
 */
export async function fetchPublic(
  url: string | URL,
  options: FetchPublicOptions = {},
): Promise<PublicResponse> {
  const { allow = [], maxBytes = Infinity, timeout = 60_000, signal, servers, userAgent } = options;
  let current = URL.parse(url);
  if (!current || !isFetchableURL(current)) throw fetchPublicError('invalid');
  if (signal?.aborted) throw fetchPublicError('aborted');

  const admits = createAdmit(allow);
  const resolver = new Resolver();
  if (servers) resolver.setServers(servers);
  const headers: Record<string, string> = { accept: '*/*', 'accept-encoding': 'identity' };
  if (!isUndefined(userAgent)) headers['user-agent'] = userAgent;

  const deadline = new AbortController();
  const expire = (): void => deadline.abort(fetchPublicError('timeout'));
  const cancel = (): void => deadline.abort(fetchPublicError('aborted'));
  const stopTotal = longTimeout(expire, timeout);
  const stopHeaders = longTimeout(expire, HEADERS_TIMEOUT);
  const finish = (): void => {
    stopTotal();
    stopHeaders();
    signal?.removeEventListener('abort', cancel);
    resolver.cancel();
  };
  signal?.addEventListener('abort', cancel, { once: true });
  deadline.signal.addEventListener('abort', finish, { once: true });
  const session = { admits, resolver, headers, signal: deadline.signal, onIdle: expire };

  try {
    for (let redirects = 0; ; redirects++) {
      const { req, res } = await exchange(current, session);
      if (REDIRECTS.has(res.statusCode!)) {
        req.destroy();
        if (redirects === MAX_REDIRECTS) throw fetchPublicError('redirects');
        current = nextHop(res.headers.location, current);
        continue;
      }

      stopHeaders();
      const refused = refusal(res, maxBytes);
      if (refused) {
        req.destroy();
        throw refused;
      }
      const length = res.headers['content-length'];
      const body = publicBody(res, deadline.signal, finish, expire);
      return {
        url: current,
        headers: toHeaders(res.rawHeaders),
        size: isUndefined(length) ? undefined : Number(length),
        body: limitStream(body, maxBytes, () => fetchPublicError('tooLarge')),
      };
    }
  } catch (error) {
    finish();
    throw error;
  }
}

/**
 * Sends one GET for `url` and resolves once the response head arrives.
 * The socket's idle timeout covers the connect and the head; `publicBody` times the body itself.
 * A literal address is vetted here: `net` only calls `lookup` for a name.
 * The `error` listener stays for the request's whole life, so a late parse error never goes unhandled.
 * A `close` before any response, as after an unsolicited `101`, settles it too.
 */
function exchange(
  url: URL,
  session: Session,
): Promise<{ req: ClientRequest; res: IncomingMessage }> {
  const { admits, resolver, headers, signal, onIdle } = session;
  const options = urlToHttpOptions(url);
  const host = options.hostname ?? '';
  const port = Number(url.port) || DEFAULT_PORTS[url.protocol];
  const admitted = admits(port);
  if (isIP(host) !== 0 && !admitted(host)) return Promise.reject(fetchPublicError('refused'));

  return new Promise((resolve, reject) => {
    const fail = (error?: unknown): void => reject(failure(error, signal));
    const init: RequestOptions = {
      ...options,
      method: 'GET',
      headers,
      agent: false,
      lookup: guardedLookup(resolver, admitted),
      signal,
      rejectUnauthorized: true,
      maxHeaderSize: MAX_HEADER_SIZE,
      insecureHTTPParser: false,
    };
    const req = url.protocol === 'https:' ? httpsRequest(init) : httpRequest(init);
    req.setTimeout(IDLE_TIMEOUT, onIdle);
    req.on('error', fail);
    req.on('close', fail);
    req.on('response', (res) => {
      req.setTimeout(0);
      resolve({ req, res });
    });
    req.end();
  });
}

/**
 * Why a final response must not be read, or `undefined` when it may.
 * A `Content-Encoding` other than identity would store bytes nobody asked for.
 * A body without `Content-Length` or chunked framing ends at close, so truncation would pass as its end.
 * A declared length past `maxBytes` fails before any byte is read.
 */
function refusal(res: IncomingMessage, maxBytes: number): FetchPublicError | undefined {
  const { statusCode, headers } = res;
  if (statusCode !== 200) return fetchPublicError('status', statusCode);
  const encoding = headers['content-encoding']?.trim().toLowerCase() ?? 'identity';
  const transfer = headers['transfer-encoding']?.trim().toLowerCase();
  const length = headers['content-length'];
  const framed = isUndefined(transfer) ? !isUndefined(length) : transfer === 'chunked';
  if (encoding !== 'identity' || !framed) return fetchPublicError('refused');
  if (!isUndefined(length) && Number(length) > maxBytes) return fetchPublicError('tooLarge');
  return undefined;
}

/**
 * The response body as a web stream whose failures are `FetchPublicError`s.
 * An abort surfaces as its reason, a cut connection as `unreachable`.
 * `onIdle` fires when a read waits `IDLE_TIMEOUT` on the remote.
 * A reader that stops pulling is never idle: only the total deadline bounds it.
 * `finish` runs once the body ends, fails, or is cancelled, and a cancel destroys the socket.
 */
function publicBody(
  res: IncomingMessage,
  signal: AbortSignal,
  finish: () => void,
  onIdle: () => void,
): ReadableStream<Uint8Array> {
  const chunks: AsyncIterator<Uint8Array> = res[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const stopIdle = longTimeout(onIdle, IDLE_TIMEOUT);
      try {
        const { done, value } = await chunks.next().finally(stopIdle);
        if (done) {
          finish();
          controller.close();
        } else controller.enqueue(value);
      } catch (error) {
        finish();
        controller.error(failure(error, signal));
      }
    },
    cancel() {
      finish();
      res.destroy();
    },
  });
}

/**
 * The `FetchPublicError` a failure stands for.
 * An aborted fetch reports its reason, since a timeout and an abort break the socket alike.
 */
function failure(error: unknown, signal: AbortSignal): FetchPublicError {
  if (signal.aborted) return signal.reason as FetchPublicError;
  return isFetchPublicError(error) ? error : fetchPublicError('unreachable');
}

/**
 * Copies a response's raw header pairs into `Headers`, repeated names included.
 */
function toHeaders(raw: string[]): Headers {
  const headers = new Headers();
  for (let i = 0; i < raw.length; i += 2) headers.append(raw[i], raw[i + 1]);
  return headers;
}
