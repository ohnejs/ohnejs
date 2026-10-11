import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { keyStep } from '../../../../src/dashboard/ui/charts/_keys.ts';

describe('keyStep', () => {
  it('steps along its axis and clamps at the ends', () => {
    strictEqual(keyStep('ArrowLeft', 2, 5), 1);
    strictEqual(keyStep('ArrowRight', 4, 5), 4);
    strictEqual(keyStep('ArrowDown', 0, 5, 'y'), 1);
    strictEqual(keyStep('ArrowUp', 0, 5, 'y'), 0);
  });

  it('starts from the last position when none is active', () => {
    strictEqual(keyStep('ArrowLeft', null, 5), 3);
  });

  it('jumps with Home and End and clears with Escape', () => {
    strictEqual(keyStep('Home', 3, 5), 0);
    strictEqual(keyStep('End', 0, 5), 4);
    strictEqual(keyStep('Escape', 3, 5), null);
  });

  it('leaves other keys, cross-axis arrows, and empty charts alone', () => {
    strictEqual(keyStep('Enter', 1, 5), undefined);
    strictEqual(keyStep('ArrowDown', 1, 5), undefined);
    strictEqual(keyStep('ArrowLeft', null, 0), undefined);
  });
});
