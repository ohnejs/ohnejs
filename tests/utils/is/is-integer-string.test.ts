import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isIntegerString } from '../../../src/utils/index.ts';

describe('isIntegerString', () => {
  it('returns true for integer-shaped strings', () => {
    strictEqual(isIntegerString('0'), true);
    strictEqual(isIntegerString('123'), true);
    strictEqual(isIntegerString('-7'), true);
    strictEqual(isIntegerString('+5'), true);
  });

  it('returns false for decimal-shaped strings', () => {
    strictEqual(isIntegerString('1.5'), false);
    strictEqual(isIntegerString('1.0'), false);
    strictEqual(isIntegerString('.5'), false);
    strictEqual(isIntegerString('1.'), false);
  });

  it('returns false for exponent-shaped strings', () => {
    strictEqual(isIntegerString('1e3'), false);
    strictEqual(isIntegerString('1E3'), false);
  });

  it('returns false for leading-zero strings', () => {
    strictEqual(isIntegerString('007'), false);
    strictEqual(isIntegerString('00'), false);
  });

  it('returns false for hex/binary/octal strings', () => {
    strictEqual(isIntegerString('0x10'), false);
    strictEqual(isIntegerString('0b10'), false);
    strictEqual(isIntegerString('0o10'), false);
  });

  it('returns false for whitespace-wrapped or empty strings', () => {
    strictEqual(isIntegerString(' 1 '), false);
    strictEqual(isIntegerString(''), false);
  });

  it('returns false for non-strings', () => {
    strictEqual(isIntegerString(42), false);
    strictEqual(isIntegerString(null), false);
    strictEqual(isIntegerString(undefined), false);
    strictEqual(isIntegerString(true), false);
  });
});
