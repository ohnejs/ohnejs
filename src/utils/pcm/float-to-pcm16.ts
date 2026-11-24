import { clamp } from '../number/clamp.ts';

/**
 * Converts float audio samples in `-1..1` to signed 16-bit PCM.
 * Samples past either end clamp; negative ones scale by `0x8000` and positive ones by `0x7fff`, rounded.
 *
 * @example
 * ```ts
 * floatToPCM16(Float32Array.of(-1, 0, 0.5, 2)) // -> Int16Array [-32768, 0, 16384, 32767]
 * ```
 */
export function floatToPCM16(samples: Float32Array): Int16Array {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const sample = clamp(samples[i], -1, 1);
    pcm[i] = Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff);
  }
  return pcm;
}
