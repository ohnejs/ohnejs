import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { parseMinorUnits } from '../../../src/utils/index.ts';

describe('parseMinorUnits', () => {
  it('scales a decimal exactly, with either separator', () => {
    strictEqual(parseMinorUnits('12.34', 2), 1234);
    strictEqual(parseMinorUnits('12,3', 2), 1230);
    strictEqual(parseMinorUnits(' 7 ', 0), 7);
    strictEqual(parseMinorUnits('.5', 2), 50);
    strictEqual(parseMinorUnits('5.', 2), 500);
  });

  it('keeps the sign, and never a negative zero', () => {
    strictEqual(parseMinorUnits('-0.05', 2), -5);
    strictEqual(parseMinorUnits('+1', 2), 100);
    strictEqual(Object.is(parseMinorUnits('-0', 2), 0), true);
  });

  it('refuses more decimals than the currency has', () => {
    strictEqual(parseMinorUnits('12.345', 2), undefined);
    strictEqual(parseMinorUnits('1.5', 0), undefined);
    strictEqual(parseMinorUnits('1.005', 2), undefined);
  });

  it('refuses grouping, exponents and bare separators', () => {
    for (const text of ['1,234.5', '1 234', '1e3', '.', '', '-', '12.3.4']) {
      strictEqual(parseMinorUnits(text, 2), undefined, text);
    }
  });

  it('stops exactly at the safe integer range', () => {
    strictEqual(parseMinorUnits('9007199254740991', 0), 9007199254740991);
    strictEqual(parseMinorUnits('90071992547409.91', 2), 9007199254740991);
    strictEqual(parseMinorUnits('90071992547409.92', 2), undefined);
    strictEqual(parseMinorUnits('9007199254740.991', 3), 9007199254740991);
  });
});
