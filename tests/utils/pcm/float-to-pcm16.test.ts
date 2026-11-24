import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { floatToPCM16 } from '../../../src/utils/index.ts';

describe('floatToPCM16', () => {
  it('scales negative samples by `0x8000` and positive ones by `0x7fff`, rounded', () => {
    deepStrictEqual(
      floatToPCM16(Float32Array.of(-1, -0.5, 0, 0.5, 1)),
      Int16Array.of(-32768, -16384, 0, 16384, 32767),
    );
  });

  it('clamps samples past either end', () => {
    deepStrictEqual(floatToPCM16(Float32Array.of(-3, 2)), Int16Array.of(-32768, 32767));
  });
});
