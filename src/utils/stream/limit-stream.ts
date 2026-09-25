/**
 * Passes `stream` through unchanged until more than `max` bytes have arrived.
 * The chunk that crosses the cap is never forwarded: the stream errors with `onExceed()`'s value instead.
 * The source is cancelled with the same value, so an upstream socket or file stops producing.
 * A stream that ends at or below `max` flows through whole, and `onExceed` is never called.
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
  let seen = 0;
  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > max) throw onExceed();
        controller.enqueue(chunk);
      },
    }),
  );
}
