import { isUndefined } from '../is/is-undefined.ts';

/**
 * Options for `formatSSE`.
 */
export interface FormatSSEOptions {
  /**
   * Event type, emitted as an `event:` line.
   * Omitted, the browser dispatches the frame as a default `message` event.
   */
  event?: string;

  /**
   * Event id, emitted as an `id:` line.
   * The browser remembers it as `Last-Event-ID` and replays it on reconnect.
   */
  id?: string;
}

/**
 * Encodes one message into a `text/event-stream` frame for Server-Sent Events.
 *
 * Each line of `data` becomes its own `data:` line, so a multi-line payload survives intact.
 * The optional `event` and `id` are emitted as their own lines first.
 * The frame ends with the blank line that terminates an event.
 *
 * @example
 * ```ts
 * formatSSE('reload')                 // -> 'data: reload\n\n'
 * formatSSE('hi', { event: 'greet' }) // -> 'event: greet\ndata: hi\n\n'
 * formatSSE('a\nb', { id: '1' })      // -> 'id: 1\ndata: a\ndata: b\n\n'
 * ```
 */
export function formatSSE(data: string, options: FormatSSEOptions = {}): string {
  let frame = '';
  if (!isUndefined(options.event)) frame += `event: ${options.event}\n`;
  if (!isUndefined(options.id)) frame += `id: ${options.id}\n`;
  for (const line of data.split(/\r\n|\r|\n/)) frame += `data: ${line}\n`;
  return `${frame}\n`;
}
