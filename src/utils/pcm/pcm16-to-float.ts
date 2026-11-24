/**
 * Converts signed 16-bit PCM samples to float audio in `-1..1`, the inverse of `floatToPCM16`.
 *
 * @example
 * ```ts
 * pcm16ToFloat(Int16Array.of(-32768, 0, 32767)) // -> Float32Array [-1, 0, 1]
 * ```
 */
export function pcm16ToFloat(samples: Int16Array): Float32Array {
  const floats = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    floats[i] = samples[i] / (samples[i] < 0 ? 0x8000 : 0x7fff);
  }
  return floats;
}
