/**
 * Writes mono 16-bit PCM `samples` at `sampleRate` Hz as a RIFF/WAVE file, the shape `parseWAV` reads.
 *
 * @example
 * ```ts
 * const bytes = encodeWAV(Int16Array.of(0, 16384, -16384), 16_000)
 * bytes.length                   // -> 50
 * parseWAV(bytes).samples.length // -> 3
 * ```
 */
export function encodeWAV(samples: Int16Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, text: string): void => {
    for (let i = 0; i < 4; i++) view.setUint8(at + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, bytes.byteLength - 8, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, samples[i], true);
  return bytes;
}
