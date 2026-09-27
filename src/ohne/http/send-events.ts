import { formatSSE, type FormatSSEOptions } from '../../utils/sse/format-sse.ts';
import { useResponse } from './use-response.ts';

const OPEN = ': open\n\n';
const MAX_QUEUED_FRAMES = 1024;

/**
 * An open Server-Sent Events stream: the response body plus the controls to push and end it.
 */
export interface EventStream {
  /**
   * The response body to return from the handler.
   * The socket stays open until `close` is called or the client disconnects.
   */
  body: ReadableStream<Uint8Array>;

  /**
   * Sends one event to the client.
   * A call after the stream has closed is a no-op.
   * An `event` or `id` holding a line break throws.
   * A stalled client is disconnected once `1024` frames sit unread, so it never buffers without bound.
   */
  send(data: string, options?: FormatSSEOptions): void;

  /**
   * Ends the stream and closes the socket.
   * Idempotent, and runs the `onClose` callback once.
   */
  close(): void;
}

/**
 * Options for `sendEvents`.
 */
export interface SendEventsOptions {
  /**
   * Called once when the stream ends, whether the server closed it or the client disconnected.
   * Use it to drop the stream from a broadcast registry.
   */
  onClose?: () => void;
}

/**
 * Opens a Server-Sent Events stream for the current request.
 *
 * Sets `text/event-stream` and `cache-control: no-cache`, then returns a body the handler returns as is.
 * The transport pipes the stream to the socket, so each `send` flushes an event and the socket stays open.
 * `close` ends it; a client disconnect ends it too, and either way `onClose` runs once.
 * Call it inside a request.
 *
 * @example
 * ```ts
 * const clients = new Set<EventStream>()
 *
 * // GET /events
 * export default defineHandler(() => {
 *   const stream = sendEvents({ onClose: () => clients.delete(stream) })
 *   clients.add(stream)
 *   return stream.body
 * })
 * ```
 */
export function sendEvents(options: SendEventsOptions = {}): EventStream {
  const headers = useResponse().headers;
  headers.set('content-type', 'text/event-stream');
  headers.set('cache-control', 'no-cache');

  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let open = true;

  const finish = (): void => {
    if (!open) return;
    open = false;
    options.onClose?.();
  };

  const body = new ReadableStream<Uint8Array>({
    start: (c) => {
      controller = c;
      c.enqueue(encoder.encode(OPEN));
    },
    cancel: finish,
  });

  return {
    body,
    send(data, frameOptions) {
      if (!open) return;
      const frame = encoder.encode(formatSSE(data, frameOptions));
      try {
        controller.enqueue(frame);
      } catch {
        finish();
        return;
      }
      // The transport stops pulling for a stalled client, so an uncapped queue grows with every send.
      if ((controller.desiredSize ?? 1) > -MAX_QUEUED_FRAMES) return;
      controller.close();
      finish();
    },
    close() {
      if (!open) return;
      controller.close();
      finish();
    },
  };
}
