import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { clamp } from '../../../src/utils/index.ts';

describe('clamp', () => {
  it('returns the value when within range', () => {
    strictEqual(clamp(5, 0, 10), 5);
  });

  it('clamps to `min` when below range', () => {
    strictEqual(clamp(-3, 0, 10), 0);
  });

  it('clamps to `max` when above range', () => {
    strictEqual(clamp(42, 0, 10), 10);
  });

  it('returns `min` when value equals `min`', () => {
    strictEqual(clamp(0, 0, 10), 0);
  });

  it('returns `max` when value equals `max`', () => {
    strictEqual(clamp(10, 0, 10), 10);
  });

  it('handles negative ranges', () => {
    strictEqual(clamp(-5, -10, -1), -5);
    strictEqual(clamp(-20, -10, -1), -10);
    strictEqual(clamp(0, -10, -1), -1);
  });

  it('handles `Infinity` bounds', () => {
    strictEqual(clamp(1e308, 0, Infinity), 1e308);
    strictEqual(clamp(-1e308, -Infinity, 0), -1e308);
  });

  it('passes `NaN` through unchanged', () => {
    strictEqual(Number.isNaN(clamp(NaN, 0, 10)), true);
  });
});
