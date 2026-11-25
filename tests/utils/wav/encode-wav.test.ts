import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { encodeWAV, parseWAV } from '../../../src/utils/index.ts';

describe('encodeWAV', () => {
  it('writes a 44-byte header and the samples little-endian', () => {
    const bytes = encodeWAV(Int16Array.of(1, -2), 8000);
    strictEqual(bytes.length, 48);
    strictEqual(new TextDecoder().decode(bytes.subarray(0, 4)), 'RIFF');
    strictEqual(new TextDecoder().decode(bytes.subarray(8, 16)), 'WAVEfmt ');
    const view = new DataView(bytes.buffer);
    strictEqual(view.getUint32(4, true), 40);
    strictEqual(view.getUint32(28, true), 16_000);
    strictEqual(view.getUint32(40, true), 4);
    deepStrictEqual([...bytes.subarray(44)], [1, 0, 0xfe, 0xff]);
  });

  it('round-trips through parseWAV', () => {
    const samples = Int16Array.of(0, 32767, -32768, 1234);
    deepStrictEqual(parseWAV(encodeWAV(samples, 16_000)), {
      sampleRate: 16_000,
      channels: 1,
      samples,
    });
  });

  it('writes an empty data chunk for no samples', () => {
    const wav = parseWAV(encodeWAV(new Int16Array(0), 16_000));
    strictEqual(wav.samples.length, 0);
  });
});
