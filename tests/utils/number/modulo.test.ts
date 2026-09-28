import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { modulo } from '../../../src/utils/index.ts';

describe('modulo', () => {
  it('matches `%` for a non-negative value', () => {
    strictEqual(modulo(7, 3), 1);
    strictEqual(modulo(0, 3), 0);
  });

  it('wraps a negative value into `[0, divisor)`', () => {
    strictEqual(modulo(-1, 12), 11);
    strictEqual(modulo(-1500, 1000), 500);
    strictEqual(modulo(-12, 12), 0);
  });

  it('takes the sign of a negative divisor', () => {
    strictEqual(modulo(1, -12), -11);
  });
});
