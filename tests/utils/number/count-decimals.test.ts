import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { countDecimals } from '../../../src/utils/index.ts';

describe('countDecimals', () => {
  it('counts none on a whole number', () => {
    strictEqual(countDecimals(0), 0);
    strictEqual(countDecimals(42), 0);
    strictEqual(countDecimals(-7), 0);
  });

  it('counts the decimal places a number prints with', () => {
    strictEqual(countDecimals(1.5), 1);
    strictEqual(countDecimals(-2.25), 2);
    strictEqual(countDecimals(123456.789), 3);
  });

  it('counts the digits binary rounding leaves in a sum', () => {
    strictEqual(countDecimals(0.1 + 0.2), 17);
  });

  it('reads through exponent notation', () => {
    strictEqual(countDecimals(1e-7), 7);
    strictEqual(countDecimals(1.5e-7), 8);
    strictEqual(countDecimals(5e-324), 324);
    strictEqual(countDecimals(1e21), 0);
    strictEqual(countDecimals(1.5e21), 0);
  });

  it('counts none on a non-finite number', () => {
    strictEqual(countDecimals(NaN), 0);
    strictEqual(countDecimals(Infinity), 0);
    strictEqual(countDecimals(-Infinity), 0);
  });
});
