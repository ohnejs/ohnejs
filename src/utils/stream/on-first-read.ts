/**
 * Wraps `stream` so `callback` runs once, just before the first chunk is read.
 * The wrapper reads nothing ahead, so a stream nobody reads never calls it.
 * Chunks, the end, and an error pass through unchanged, and cancelling the wrapper cancels `stream`.
 *
 * @example
 * ```ts
 * const body = onFirstRead(new Blob(['abc']).stream(), () => console.log('reading'))
 * await new Response(body).text() // -> 'abc', after logging 'reading'
 * ```
 */
export function onFirstRead<T>(stream: ReadableStream<T>, callback: () => void): ReadableStream<T> {
  const reader = stream.getReader();
  let first = true;
  return new ReadableStream<T>(
    {
      async pull(controller) {
        if (first) {
          first = false;
          callback();
        }
        const { done, value } = await reader.read();
        if (done) controller.close();
        else controller.enqueue(value);
      },
      cancel: (reason) => reader.cancel(reason),
    },
    { highWaterMark: 0 },
  );
}
