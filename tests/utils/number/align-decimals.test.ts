import { deepStrictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { alignDecimals } from '../../../src/utils/index.ts';

describe('alignDecimals', () => {
  it('scales every value to the most decimals any of them prints', () => {
    deepStrictEqual(alignDecimals([0.25, 3]), { coefficients: [25n, 300n], scale: 2 });
    deepStrictEqual(alignDecimals([0.1 + 0.2]), { coefficients: [30000000000000004n], scale: 17 });
  });

  it('reads exponent notation and negatives', () => {
    deepStrictEqual(alignDecimals([1e21, 1e-7, -2.25, -0.5]), {
      coefficients: [10n ** 28n, 1n, -22500000n, -5000000n],
      scale: 7,
    });
  });

  it('keeps whole numbers at scale 0, `-0` as 0', () => {
    deepStrictEqual(alignDecimals([-0, 42]), { coefficients: [0n, 42n], scale: 0 });
    deepStrictEqual(alignDecimals([]), { coefficients: [], scale: 0 });
  });

  it('throws on a non-finite value', () => {
    throws(() => alignDecimals([NaN]), SyntaxError);
    throws(() => alignDecimals([Infinity]), SyntaxError);
  });
});
