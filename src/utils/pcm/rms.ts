/**
 * The root mean square of float audio `samples`, their loudness on the `0..1` scale of the samples.
 * No samples read as silence.
 *
 * @example
 * ```ts
 * rms(Float32Array.of(0.5, -0.5)) // -> 0.5
 * rms(new Float32Array(0))        // -> 0
 * ```
 */
export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}
