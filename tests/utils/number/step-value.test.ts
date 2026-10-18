import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { stepValue } from '../../../src/utils/index.ts';

describe('stepValue', () => {
  it('moves along the grid exactly in decimal', () => {
    strictEqual(stepValue(0.1 + 0.2, 1, { step: 0.1 }), 0.4);
    strictEqual(stepValue(0.1 + 0.2, -1, { step: 0.1 }), 0.3);
    strictEqual(stepValue(0.7, 3, { step: 0.1 }), 1);
    strictEqual(stepValue(-0.3, -1, { step: 0.1 }), -0.4);
  });

  it('lands an off-grid value on the nearest grid point in the direction of travel', () => {
    strictEqual(stepValue(0.3, 1, { step: 0.25 }), 0.5);
    strictEqual(stepValue(0.3, -1, { step: 0.25 }), 0.25);
    strictEqual(stepValue(1.6, 1, { step: 0.5, min: 0.25 }), 1.75);
  });

  it('stays on the last grid point inside the bounds', () => {
    strictEqual(stepValue(9, 1, { step: 3, min: 0, max: 10 }), 9);
    strictEqual(stepValue(12, -1, { step: 3, min: 0, max: 10 }), 9);
    strictEqual(stepValue(-5, 1, { step: 3, min: 0, max: 10 }), 0);
    strictEqual(stepValue(2, -5, { step: 0.5, min: 1, max: 3 }), 1);
  });

  it('steps by 1 without a `step`', () => {
    strictEqual(stepValue(4, 10, {}), 14);
    strictEqual(stepValue(4.5, 1, { max: 5 }), 5);
  });

  it('passes a non-finite value through', () => {
    strictEqual(stepValue(NaN, 1, { step: 1 }), NaN);
  });
});
