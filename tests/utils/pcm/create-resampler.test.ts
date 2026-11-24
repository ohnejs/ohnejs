import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { createResampler } from '../../../src/utils/index.ts';

function wave(length: number): Float32Array {
  return Float32Array.from({ length }, (_, i) => Math.sin(i / 7));
}

describe('createResampler', () => {
  it('keeps a constant constant from 48k to 16k', () => {
    const output = createResampler(48_000, 16_000)(new Float32Array(4800).fill(0.25));
    strictEqual(output.length, 1600);
    strictEqual(
      output.every((sample) => sample === 0.25),
      true,
    );
  });

  it('box-averages each window when downsampling', () => {
    deepStrictEqual(
      createResampler(3, 1)(Float32Array.of(1, 2, 3, 4, 5, 6)),
      Float32Array.of(2, 5),
    );
  });

  it('gives the same stream for chunks 4800 + 4801 as for one chunk of 9601', () => {
    const input = wave(9601);
    const chunked = createResampler(48_000, 16_000);
    const parts = [...chunked(input.subarray(0, 4800)), ...chunked(input.subarray(4800))];
    deepStrictEqual(Float32Array.from(parts), createResampler(48_000, 16_000)(input));
  });

  it('streams a non-integer ratio exactly across odd chunks', () => {
    const input = wave(44_100);
    const chunked = createResampler(44_100, 16_000);
    const parts: number[] = [];
    for (let at = 0; at < input.length; at += 997)
      parts.push(...chunked(input.subarray(at, at + 997)));
    deepStrictEqual(Float32Array.from(parts), createResampler(44_100, 16_000)(input));
    strictEqual(parts.length, 16_000);
  });

  it('upsamples 16k to 24k by the length ratio, interpolating linearly', () => {
    const resample = createResampler(16_000, 24_000);
    const first = resample(Float32Array.from({ length: 1600 }, (_, i) => i));
    strictEqual(first.length, 2399);
    deepStrictEqual(
      Array.from(first.subarray(0, 4), (sample) => Math.round(sample * 3) / 3),
      [0, 2 / 3, 4 / 3, 2],
    );
    strictEqual(first.length + resample(new Float32Array(1600)).length, 4800 - 1);
  });

  it('returns the input itself at equal rates', () => {
    const input = wave(10);
    strictEqual(createResampler(16_000, 16_000)(input), input);
  });
});
