import { deepStrictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { parseWAV } from '../../../src/utils/index.ts';

interface Spec {
  format?: number;
  channels?: number;
  sampleRate?: number;
  bits?: number;
  samples: number[];
  extra?: boolean;
}

function wav(spec: Spec): Uint8Array {
  const { format = 1, channels = 1, sampleRate = 16_000, bits = 16, samples, extra = false } = spec;
  const extraSize = extra ? 8 + 5 + 1 : 0;
  const bytes = new Uint8Array(44 + extraSize + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, text: string): void => {
    for (let i = 0; i < 4; i++) view.setUint8(at + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, bytes.byteLength - 8, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * (bits / 8), true);
  view.setUint16(32, channels * (bits / 8), true);
  view.setUint16(34, bits, true);
  let at = 36;
  if (extra) {
    ascii(at, 'LIST');
    view.setUint32(at + 4, 5, true);
    at += extraSize;
  }
  ascii(at, 'data');
  view.setUint32(at + 4, samples.length * 2, true);
  samples.forEach((sample, i) => view.setInt16(at + 8 + i * 2, sample, true));
  return bytes;
}

describe('parseWAV', () => {
  it('reads a mono 16-bit file', () => {
    deepStrictEqual(parseWAV(wav({ samples: [0, 1000, -1000, 32767] })), {
      sampleRate: 16_000,
      channels: 1,
      samples: Int16Array.of(0, 1000, -1000, 32767),
    });
  });

  it('downmixes stereo to the rounded mean of each frame', () => {
    deepStrictEqual(
      parseWAV(wav({ channels: 2, sampleRate: 48_000, samples: [100, 300, -1, -2, 32767, 32767] })),
      {
        sampleRate: 48_000,
        channels: 2,
        samples: Int16Array.of(200, -1, 32767),
      },
    );
  });

  it('skips other chunks, including an odd-sized one with its pad byte', () => {
    deepStrictEqual(parseWAV(wav({ samples: [7, 8], extra: true })).samples, Int16Array.of(7, 8));
  });

  it('reads a file at an offset inside a larger buffer', () => {
    const file = wav({ samples: [5, 6] });
    const padded = new Uint8Array(file.byteLength + 3);
    padded.set(file, 3);
    deepStrictEqual(parseWAV(padded.subarray(3)).samples, Int16Array.of(5, 6));
  });

  it('throws for float, 8-bit, or a file that is not WAV', () => {
    throws(() => parseWAV(wav({ format: 3, bits: 32, samples: [0, 0] })), {
      message: 'WAV file is not 16-bit PCM',
    });
    throws(() => parseWAV(wav({ bits: 8, samples: [0] })), {
      message: 'WAV file is not 16-bit PCM',
    });
    throws(() => parseWAV(new TextEncoder().encode('RIFF....AVI LIST')), {
      message: 'Not a WAV file',
    });
    throws(() => parseWAV(new Uint8Array(4)), { message: 'Not a WAV file' });
  });

  it('throws for a file without a data chunk', () => {
    throws(() => parseWAV(wav({ samples: [] }).subarray(0, 36)), {
      message: 'WAV file lacks a fmt or data chunk',
    });
  });
});
