import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isDecimalString } from '../../../src/utils/index.ts';

describe('isDecimalString', () => {
  it('returns true for integer-shaped strings', () => {
    strictEqual(isDecimalString('0'), true);
    strictEqual(isDecimalString('123'), true);
    strictEqual(isDecimalString('-7'), true);
    strictEqual(isDecimalString('+5'), true);
  });

  it('returns true for fractional-shaped strings', () => {
    strictEqual(isDecimalString('1.5'), true);
    strictEqual(isDecimalString('-0.5'), true);
    strictEqual(isDecimalString('.5'), true);
    strictEqual(isDecimalString('1.'), true);
  });

  it('returns true for exponent-shaped strings', () => {
    strictEqual(isDecimalString('1e3'), true);
    strictEqual(isDecimalString('-1.5e-3'), true);
    strictEqual(isDecimalString('+2E+10'), true);
  });

  it('returns false for non-decimal strings', () => {
    strictEqual(isDecimalString('0x10'), false);
    strictEqual(isDecimalString('0b10'), false);
    strictEqual(isDecimalString('0o10'), false);
    strictEqual(isDecimalString('Infinity'), false);
    strictEqual(isDecimalString('NaN'), false);
    strictEqual(isDecimalString(' 1 '), false);
    strictEqual(isDecimalString(''), false);
    strictEqual(isDecimalString('.'), false);
    strictEqual(isDecimalString('1e'), false);
  });

  it('returns false for non-strings', () => {
    strictEqual(isDecimalString(1.5), false);
    strictEqual(isDecimalString(null), false);
    strictEqual(isDecimalString(undefined), false);
    strictEqual(isDecimalString(true), false);
  });
});
