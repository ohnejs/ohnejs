/**
 * Reads `stream` as consecutive chunks of exactly `size` bytes, the last one holding the remainder.
 * An empty stream yields nothing, and a size below `1` throws: no chunk could ever fill.
 * Each yielded chunk is its own buffer, so a consumer may hold it while the next one fills.
 * A chunk is allocated only once its bytes have arrived, at their length, so a short stream holds no more.
 * Ending the loop early, by `break` or a throw, cancels the source.
 *
 * @example
 * ```ts
 * const parts = await Array.fromAsync(rechunkStream(new Blob(['abcdefg']).stream(), 3))
 * parts.map((part) => part.byteLength) // -> [3, 3, 1]
 * ```
 */
export async function* rechunkStream(
  stream: ReadableStream<Uint8Array>,
  size: number,
): AsyncGenerator<Uint8Array, void, undefined> {
  if (size < 1) throw new Error(`Invalid chunk size: ${size}`);
  const reader = stream.getReader();
  const pending: Uint8Array[] = [];
  let buffered = 0;
  let finished = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pending.push(value);
      buffered += value.byteLength;
      for (; buffered >= size; buffered -= size) yield take(pending, size);
    }
    finished = true;
    if (buffered > 0) yield take(pending, buffered);
  } finally {
    if (!finished) await reader.cancel();
  }
}

/**
 * Copies the first `length` bytes of `pending` into a buffer of their own, dropping the pieces it used up.
 */
function take(pending: Uint8Array[], length: number): Uint8Array {
  const chunk = new Uint8Array(length);
  let filled = 0;
  let used = 0;
  while (filled < length) {
    const piece = pending[used]!;
    const count = Math.min(length - filled, piece.byteLength);
    chunk.set(piece.subarray(0, count), filled);
    filled += count;
    if (count === piece.byteLength) used++;
    else pending[used] = piece.subarray(count);
  }
  pending.splice(0, used);
  return chunk;
}
