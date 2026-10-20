import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { nonNegativeNumber } from '../../../src/utils/index.ts';

describe('nonNegativeNumber', () => {
  it('reads a finite number at or above 0', () => {
    strictEqual(nonNegativeNumber(0), 0);
    strictEqual(nonNegativeNumber(2.5), 2.5);
  });

  it('gives `undefined` for anything else', () => {
    for (const value of [-1, NaN, Infinity, '3', undefined]) {
      strictEqual(nonNegativeNumber(value), undefined);
    }
  });
});
