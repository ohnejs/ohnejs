import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { floatToPCM16, pcm16ToFloat } from '../../../src/utils/index.ts';

describe('pcm16ToFloat', () => {
  it('maps both ends to `-1` and `1`', () => {
    deepStrictEqual(pcm16ToFloat(Int16Array.of(-32768, 0, 32767)), Float32Array.of(-1, 0, 1));
  });

  it('inverts `floatToPCM16`', () => {
    const pcm = Int16Array.of(-32768, -1234, -1, 0, 1, 4321, 32767);
    deepStrictEqual(floatToPCM16(pcm16ToFloat(pcm)), pcm);
  });
});
