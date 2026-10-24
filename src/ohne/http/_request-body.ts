import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';

import { finished } from 'node:stream';

import { coerceToNumber, isNull, isNullish, isNumber, isUndefined } from '../../utils/index.ts';

/**
 * The most unread request body, in bytes, an error answer discards to keep its connection.
 */
const DRAIN_LIMIT = 256 * 1024;

/**
 * How long a closing connection keeps discarding what the client still sends, in milliseconds.
 */
const LINGER = 5_000;

const abandons = new WeakMap<IncomingMessage, () => void>();

const released = new WeakSet<ServerResponse>();

/**
 * Reads `req`'s body as a Web stream, with backpressure, each chunk copied off Node's shared pool.
 * Cancelling it discards the rest of the body rather than destroying `req`.
 * A destroyed request detaches from its socket and stalls the parser, so the connection would hang.
 * A body still open when its answer finishes errors with an `AbortError`, so it never ends short.
 */
export function streamBody(req: IncomingMessage): ReadableStream<Uint8Array> {
  let settled = false;
  const onData = (chunk: Buffer): void => {
    if (settled) return;
    controller.enqueue(new Uint8Array(chunk));
    if ((controller.desiredSize ?? 0) <= 0) req.pause();
  };
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>(
    {
      start(own) {
        controller = own;
      },
      pull() {
        req.resume();
      },
      cancel() {
        settled = true;
        req.off('data', onData);
        req.resume();
      },
    },
    new ByteLengthQueuingStrategy({ highWaterMark: req.readableHighWaterMark }),
  );
  req.pause();
  req.on('data', onData);
  abandons.set(req, () => {
    if (settled) return;
    settled = true;
    req.off('data', onData);
    controller.error(
      new DOMException('The answer finished before the body was read', 'AbortError'),
    );
  });
  finished(req, { writable: false }, (error) => {
    if (settled) return;
    settled = true;
    if (isNullish(error)) controller.close();
    else controller.error(error);
  });
  return stream;
}

/**
 * Settles the connection of `res` while its request body is still arriving.
 * After an error status, a rest over `DRAIN_LIMIT` or of unknown size announces `Connection: close`.
 * A browser accepts only an error answer to an upload it could not finish, so a success keeps the connection.
 * Once `res` finishes, the rest is discarded, and a body still being read errors.
 * A closing connection lingers until the client stops sending, so its unread bytes cannot reset the answer.
 * Call it before the headers go out; calling it again for the same `res` only re-checks the header.
 */
export function releaseConnection(res: ServerResponse): void {
  const { req } = res;
  if (!res.headersSent && refusesRest(res)) res.setHeader('connection', 'close');
  // Read now: a queued answer has no socket yet, and a finished request detaches from its own.
  const socket = req.socket;
  if (released.has(res) || isNull(socket)) return;
  released.add(res);
  res.once('finish', () => {
    if (req.complete || !hasBody(req)) return;
    if (socket.writableEnded) {
      // Node closes it on this same tick by destroying it, which resets the client still sending.
      socket.off('finish', socket.destroy);
      linger(socket);
    }
    // A body that just arrived whole reads complete only once the parser finishes its packet.
    setImmediate(() => discard(req));
  });
}

/**
 * Whether `res` refuses a request body too large, or of unknown size, to discard and keep the connection.
 */
function refusesRest(res: ServerResponse): boolean {
  const { req } = res;
  if (res.statusCode < 400 || req.complete || !hasBody(req)) return false;
  const length = coerceToNumber(req.headers['content-length']);
  return !isNumber(length) || length > DRAIN_LIMIT;
}

/**
 * Whether `req` carries a body, by its `Content-Length` or `Transfer-Encoding`.
 */
function hasBody(req: IncomingMessage): boolean {
  if (!isUndefined(req.headers['transfer-encoding'])) return true;
  const length = coerceToNumber(req.headers['content-length']);
  return isNumber(length) && length > 0;
}

/**
 * Discards what is left of `req`'s body, erroring the stream still reading it.
 */
function discard(req: IncomingMessage): void {
  if (req.complete || req.destroyed) return;
  abandons.get(req)?.();
  req.resume();
}

/**
 * Ends `socket` after its answer and keeps reading until the client closes or `LINGER` runs out.
 */
function linger(socket: Socket): void {
  if (socket.destroyed) return;
  socket.end();
  socket.resume();
  const timer = setTimeout(() => socket.destroy(), LINGER).unref();
  socket.once('close', () => clearTimeout(timer));
}
