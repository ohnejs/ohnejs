import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { rms } from '../../../src/utils/index.ts';

describe('rms', () => {
  it('reads a constant magnitude as itself', () => {
    strictEqual(rms(Float32Array.of(0.5, -0.5, 0.5)), 0.5);
  });

  it('weighs loud samples more than the mean would', () => {
    strictEqual(rms(Float32Array.of(1, 0, 0, 0)), 0.5);
  });

  it('reads no samples as silence', () => {
    strictEqual(rms(new Float32Array(0)), 0);
  });
});
