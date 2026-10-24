/**
 * Passes `stream` through unchanged until more than `max` bytes have arrived.
 * The chunk that crosses the cap is never forwarded: the stream errors with `onExceed()`'s value instead.
 * The source is cancelled with the same value, so an upstream socket or file stops producing.
 * A stream that ends at or below `max` flows through whole, and `onExceed` is never called.
 * It reads the source only as its consumer reads, and cancelling it cancels the source with the same reason.
 *
 * @example
 * ```ts
 * const body = limitStream(new Blob(['abcdef']).stream(), 4, () => new RangeError('Too large'))
 * await new Response(body).text() // -> rejects with RangeError: Too large
 * ```
 */
export function limitStream(
  stream: ReadableStream<Uint8Array>,
  max: number,
  onExceed: () => unknown,
): ReadableStream<Uint8Array> {
  // A reader, not `pipeThrough`: Node 26.4 leaves the pipe's promises unhandled when the result is cancelled.
  const reader = stream.getReader();
  let seen = 0;
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) return controller.close();
        seen += value.byteLength;
        if (seen <= max) return controller.enqueue(value);
        const error = onExceed();
        controller.error(error);
        await reader.cancel(error);
      },
      cancel: (reason) => reader.cancel(reason),
    },
    { highWaterMark: 0 },
  );
}
