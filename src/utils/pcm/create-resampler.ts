/**
 * Creates a streaming resampler from `from` Hz to `to` Hz for mono float audio.
 * Feed it consecutive chunks: it carries the samples and position between calls.
 * So chunks of any size give the same stream as one big chunk.
 *
 * Downsampling averages each output sample's window of input, a box filter that tames aliasing.
 * Upsampling interpolates linearly, so it holds back the last input sample until the next chunk.
 * With `from === to` the input comes back as is.
 *
 * @example
 * ```ts
 * const resample = createResampler(48_000, 16_000)
 * resample(new Float32Array(4800)).length // -> 1600
 * resample(new Float32Array(10)).length   // -> 3
 * resample(new Float32Array(2)).length    // -> 1
 * ```
 */
export function createResampler(from: number, to: number): (input: Float32Array) => Float32Array {
  if (from === to) return (input) => input;

  const down = from > to;
  let carried = new Float32Array(0);
  let offset = 0;
  let produced = 0;

  return (input) => {
    const buffer = new Float32Array(carried.length + input.length);
    buffer.set(carried);
    buffer.set(input, carried.length);
    const end = offset + buffer.length;
    const output = new Float32Array(Math.max(0, Math.floor((end * to) / from) - produced + 1));

    let count = 0;
    for (; ; produced++, count++) {
      const position = produced * from;
      const start = Math.floor(position / to);
      if (down) {
        const stop = Math.floor((position + from) / to);
        if (stop > end) break;
        let sum = 0;
        for (let i = start; i < stop; i++) sum += buffer[i - offset];
        output[count] = sum / (stop - start);
      } else {
        if (start + 1 >= end) break;
        const a = buffer[start - offset];
        output[count] = a + (buffer[start + 1 - offset] - a) * ((position % to) / to);
      }
    }

    const keep = Math.floor((produced * from) / to);
    carried = buffer.slice(keep - offset);
    offset = keep;
    return output.subarray(0, count);
  };
}
