import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { coerceToInteger } from '../../../src/utils/index.ts';

describe('coerceToInteger', () => {
  it('coerces integer strings', () => {
    strictEqual(coerceToInteger('123'), 123);
    strictEqual(coerceToInteger('-7'), -7);
    strictEqual(coerceToInteger('0'), 0);
  });

  it('truncates decimal strings', () => {
    strictEqual(coerceToInteger('1.9'), 1);
    strictEqual(coerceToInteger('-1.9'), -1);
  });

  it('coerces booleans to 1 / 0', () => {
    strictEqual(coerceToInteger(true), 1);
    strictEqual(coerceToInteger(false), 0);
  });

  it('returns non-parseable strings unchanged', () => {
    strictEqual(coerceToInteger('abc'), 'abc');
    strictEqual(coerceToInteger(''), '');
    strictEqual(coerceToInteger('   '), '   ');
  });

  it('returns null, undefined, numbers, objects unchanged', () => {
    strictEqual(coerceToInteger(null), null);
    strictEqual(coerceToInteger(undefined), undefined);
    strictEqual(coerceToInteger(123), 123);
    const obj = { a: 1 };
    strictEqual(coerceToInteger(obj), obj);
  });

  it('returns Infinity-like strings unchanged', () => {
    strictEqual(coerceToInteger('Infinity'), 'Infinity');
    strictEqual(coerceToInteger('-Infinity'), '-Infinity');
  });

  it('returns hex/binary/octal/whitespace-wrapped strings unchanged', () => {
    strictEqual(coerceToInteger('0x10'), '0x10');
    strictEqual(coerceToInteger('0b10'), '0b10');
    strictEqual(coerceToInteger('0o10'), '0o10');
    strictEqual(coerceToInteger('  42  '), '  42  ');
    strictEqual(coerceToInteger('42 '), '42 ');
  });

  it('returns unsafe-int-shaped strings unchanged', () => {
    strictEqual(coerceToInteger('1e20'), '1e20');
    strictEqual(coerceToInteger(String(Number.MAX_SAFE_INTEGER + 1)), '9007199254740992');
  });

  it('coerces safe-int-shaped scientific notation', () => {
    strictEqual(coerceToInteger('1e3'), 1000);
    strictEqual(coerceToInteger('-2.5e2'), -250);
  });
});
