import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { easeInOutCubic } from '../../../src/utils/index.ts';

describe('easeInOutCubic', () => {
  it('pins the ends', () => {
    strictEqual(easeInOutCubic(0), 0);
    strictEqual(easeInOutCubic(1), 1);
  });

  it('crosses the midpoint at a half', () => {
    strictEqual(easeInOutCubic(0.5), 0.5);
  });

  it('is symmetric around the midpoint', () => {
    strictEqual(easeInOutCubic(0.25), 0.0625);
    strictEqual(easeInOutCubic(0.75), 0.9375);
  });

  it('clamps input outside `[0, 1]`', () => {
    strictEqual(easeInOutCubic(-1), 0);
    strictEqual(easeInOutCubic(3), 1);
  });
});
