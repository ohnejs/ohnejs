/**
 * A stream that calls `open` for its source only when first read, then passes the source through.
 * The wrapper reads nothing ahead, so a stream nobody reads never opens its source.
 * Chunks, the end, and an error pass through unchanged, and cancelling the wrapper cancels an opened source.
 *
 * @example
 * ```ts
 * const body = lazyStream(() => new Blob(['abc']).stream())
 * await new Response(body).text() // -> 'abc', opening the source on this read
 * ```
 */
export function lazyStream<T>(open: () => ReadableStream<T>): ReadableStream<T> {
  let reader: ReadableStreamDefaultReader<T> | undefined;
  return new ReadableStream<T>(
    {
      async pull(controller) {
        reader ??= open().getReader();
        const { done, value } = await reader.read();
        if (done) controller.close();
        else controller.enqueue(value);
      },
      cancel: (reason) => reader?.cancel(reason),
    },
    { highWaterMark: 0 },
  );
}
