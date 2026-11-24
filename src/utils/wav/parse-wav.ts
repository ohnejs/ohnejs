import { isUndefined } from '../is/is-undefined.ts';

/**
 * The audio of a WAV file, downmixed to mono 16-bit PCM.
 */
export interface WAV {
  /**
   * Samples per second, such as `16000`.
   */
  sampleRate: number;

  /**
   * How many channels the file held before the downmix.
   */
  channels: number;

  /**
   * The mono samples, each the rounded mean of a frame's channels.
   */
  samples: Int16Array;
}

/**
 * Reads a RIFF/WAVE file of 16-bit PCM into its sample rate and mono samples.
 * Chunks other than `fmt ` and `data` are skipped, and several channels are averaged into one.
 * Anything but 16-bit PCM (format `1`), or a file missing either chunk, throws.
 *
 * @example
 * ```ts
 * const wav = parseWAV(new Uint8Array(await readFile('hello.wav')))
 * wav.sampleRate     // -> 16000
 * wav.samples.length // -> 32000
 * ```
 */
export function parseWAV(bytes: Uint8Array): WAV {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 12 || fourCC(view, 0) !== 'RIFF' || fourCC(view, 8) !== 'WAVE') {
    throw new Error('Not a WAV file');
  }

  let format: { code: number; channels: number; sampleRate: number; bits: number } | undefined;
  let data: DataView | undefined;
  for (let at = 12; at + 8 <= bytes.byteLength;) {
    const id = fourCC(view, at);
    const size = Math.min(view.getUint32(at + 4, true), bytes.byteLength - at - 8);
    if (id === 'fmt ' && size >= 16) {
      format = {
        code: view.getUint16(at + 8, true),
        channels: view.getUint16(at + 10, true),
        sampleRate: view.getUint32(at + 12, true),
        bits: view.getUint16(at + 22, true),
      };
    } else if (id === 'data') {
      data = new DataView(bytes.buffer, bytes.byteOffset + at + 8, size);
    }
    at += 8 + size + (size % 2);
  }

  if (isUndefined(format) || isUndefined(data))
    throw new Error('WAV file lacks a fmt or data chunk');
  if (format.code !== 1 || format.bits !== 16 || format.channels === 0) {
    throw new Error('WAV file is not 16-bit PCM');
  }

  const { channels } = format;
  const samples = new Int16Array(Math.floor(data.byteLength / 2 / channels));
  for (let frame = 0; frame < samples.length; frame++) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel++) {
      sum += data.getInt16((frame * channels + channel) * 2, true);
    }
    samples[frame] = Math.round(sum / channels);
  }
  return { sampleRate: format.sampleRate, channels, samples };
}

/**
 * The four ASCII characters at `at` in `view`, such as a chunk id.
 */
function fourCC(view: DataView, at: number): string {
  return String.fromCharCode(
    view.getUint8(at),
    view.getUint8(at + 1),
    view.getUint8(at + 2),
    view.getUint8(at + 3),
  );
}
