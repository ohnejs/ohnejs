import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isStepMultiple } from '../../../src/utils/index.ts';

describe('isStepMultiple', () => {
  it('checks the grid exactly in decimal', () => {
    strictEqual(isStepMultiple(0.3, 0.1), true);
    strictEqual(isStepMultiple(0.07, 0.01), true);
    strictEqual(isStepMultiple(4.35, 0.05), true);
    strictEqual(isStepMultiple(0.1 + 0.2, 0.1), false);
  });

  it('holds past the safe integer range', () => {
    strictEqual(isStepMultiple(1e15 + 0.5, 0.5), true);
    strictEqual(isStepMultiple(4503599627370495.5, 0.5), true);
    strictEqual(isStepMultiple(4503599627370495.5, 1), false);
  });

  it('measures the grid from `base`', () => {
    strictEqual(isStepMultiple(1.75, 0.5, 0.25), true);
    strictEqual(isStepMultiple(1.5, 0.5, 0.25), false);
    strictEqual(isStepMultiple(-0.75, 0.5, 0.25), true);
  });

  it('never matches a non-finite input or a step not above 0', () => {
    strictEqual(isStepMultiple(NaN, 1), false);
    strictEqual(isStepMultiple(1, 0), false);
    strictEqual(isStepMultiple(1, -1), false);
    strictEqual(isStepMultiple(1, Infinity), false);
  });
});
