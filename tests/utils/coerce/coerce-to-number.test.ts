import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { coerceToNumber } from '../../../src/utils/index.ts';

describe('coerceToNumber', () => {
  it('coerces integer strings', () => {
    strictEqual(coerceToNumber('123'), 123);
    strictEqual(coerceToNumber('-7'), -7);
  });

  it('coerces decimal strings without truncating', () => {
    strictEqual(coerceToNumber('1.5'), 1.5);
    strictEqual(coerceToNumber('-0.25'), -0.25);
  });

  it('coerces booleans to 1 / 0', () => {
    strictEqual(coerceToNumber(true), 1);
    strictEqual(coerceToNumber(false), 0);
  });

  it('returns non-parseable strings unchanged', () => {
    strictEqual(coerceToNumber('abc'), 'abc');
    strictEqual(coerceToNumber(''), '');
    strictEqual(coerceToNumber('   '), '   ');
  });

  it('returns null, undefined, numbers, objects unchanged', () => {
    strictEqual(coerceToNumber(null), null);
    strictEqual(coerceToNumber(undefined), undefined);
    strictEqual(coerceToNumber(1.5), 1.5);
    const obj = { a: 1 };
    strictEqual(coerceToNumber(obj), obj);
  });

  it('returns hex/binary/octal/whitespace-wrapped strings unchanged', () => {
    strictEqual(coerceToNumber('0x10'), '0x10');
    strictEqual(coerceToNumber('0b10'), '0b10');
    strictEqual(coerceToNumber('0o10'), '0o10');
    strictEqual(coerceToNumber('  42  '), '  42  ');
  });

  it('returns Infinity-shaped strings unchanged', () => {
    strictEqual(coerceToNumber('Infinity'), 'Infinity');
    strictEqual(coerceToNumber('-Infinity'), '-Infinity');
  });
});
