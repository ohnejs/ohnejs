import { isUndefined } from '../is/is-undefined.ts';

/**
 * One event read from a `text/event-stream` body by `parseSSE`.
 */
export interface SSEMessage {
  /**
   * The `event:` type, or `'message'` when the event names none.
   */
  event: string;

  /**
   * The event's `data:` lines, joined with `\n`.
   */
  data: string;

  /**
   * The last `id:` the stream set, carried over to every later event as `EventSource` does.
   * Empty until the stream sets one.
   */
  id: string;

  /**
   * The last `retry:` the stream set, the reconnection delay in milliseconds.
   * Absent until the stream sets one.
   */
  retry?: number;
}

const LINE_BREAK = /\r\n|\r|\n/;
const DIGITS = /^\d+$/;

/**
 * Reads a `text/event-stream` body into its events, the way `EventSource` does, for streams it cannot open.
 * A `fetch` with a method or a body, such as a streamed `POST` answer, is read this way.
 *
 * Lines may end in CRLF, LF or CR, and a comment line starting with `:` is skipped.
 * An event without `data:` lines is not yielded, nor is one cut off by the end of the stream.
 * Leaving the loop early cancels the stream.
 *
 * @example
 * ```ts
 * const response = await fetch('/ai/turns', { method: 'POST', body })
 *
 * for await (const message of parseSSE(response.body!)) {
 *   console.log(message) // -> { event: 'text', data: 'Hello', id: '' }
 * }
 * ```
 */
export async function* parseSSE(stream: ReadableStream<Uint8Array>): AsyncGenerator<SSEMessage> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let event = '';
  let data = '';
  let id = '';
  let retry: number | undefined;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      const text = pending + decoder.decode(value, { stream: !done });
      // A trailing CR may be the first half of a CRLF split across chunks.
      const end = !done && text.endsWith('\r') ? text.length - 1 : text.length;
      const lines = text.slice(0, end).split(LINE_BREAK);
      pending = lines.pop() + text.slice(end);
      for (const line of lines) {
        if (line === '') {
          if (data !== '') {
            const message: SSEMessage = { event: event || 'message', data: data.slice(0, -1), id };
            if (!isUndefined(retry)) message.retry = retry;
            yield message;
          }
          event = '';
          data = '';
          continue;
        }
        const colon = line.indexOf(':');
        if (colon === 0) continue;
        const field = colon === -1 ? line : line.slice(0, colon);
        const content = colon === -1 ? '' : line.slice(colon + (line[colon + 1] === ' ' ? 2 : 1));
        if (field === 'event') event = content;
        else if (field === 'data') data += `${content}\n`;
        else if (field === 'id' && !content.includes('\0')) id = content;
        else if (field === 'retry' && DIGITS.test(content)) retry = Number(content);
      }
      if (done) return;
    }
  } finally {
    await reader.cancel();
  }
}
