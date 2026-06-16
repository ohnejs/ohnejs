import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { coerceToPositiveInteger } from '../../../src/utils/index.ts';

describe('coerceToPositiveInteger', () => {
  it('coerces positive integer strings', () => {
    strictEqual(coerceToPositiveInteger('123'), 123);
    strictEqual(coerceToPositiveInteger('1'), 1);
    strictEqual(coerceToPositiveInteger('+5'), 5);
  });

  it('truncates positive decimal strings', () => {
    strictEqual(coerceToPositiveInteger('1.9'), 1);
    strictEqual(coerceToPositiveInteger('2.5e2'), 250);
  });

  it('coerces true to 1, leaves false unchanged', () => {
    strictEqual(coerceToPositiveInteger(true), 1);
    strictEqual(coerceToPositiveInteger(false), false);
  });

  it('returns zero-shaped and negative strings unchanged', () => {
    strictEqual(coerceToPositiveInteger('0'), '0');
    strictEqual(coerceToPositiveInteger('-5'), '-5');
    strictEqual(coerceToPositiveInteger('-1.9'), '-1.9');
  });

  it('returns non-parseable strings unchanged', () => {
    strictEqual(coerceToPositiveInteger('abc'), 'abc');
    strictEqual(coerceToPositiveInteger(''), '');
    strictEqual(coerceToPositiveInteger('   '), '   ');
  });

  it('returns null, undefined, numbers, objects unchanged', () => {
    strictEqual(coerceToPositiveInteger(null), null);
    strictEqual(coerceToPositiveInteger(undefined), undefined);
    strictEqual(coerceToPositiveInteger(123), 123);
    strictEqual(coerceToPositiveInteger(0), 0);
    strictEqual(coerceToPositiveInteger(-5), -5);
    const obj = { a: 1 };
    strictEqual(coerceToPositiveInteger(obj), obj);
  });

  it('returns hex/binary/octal/whitespace-wrapped strings unchanged', () => {
    strictEqual(coerceToPositiveInteger('0x10'), '0x10');
    strictEqual(coerceToPositiveInteger('0b10'), '0b10');
    strictEqual(coerceToPositiveInteger('0o10'), '0o10');
    strictEqual(coerceToPositiveInteger('  42  '), '  42  ');
  });

  it('returns unsafe-int-shaped strings unchanged', () => {
    strictEqual(coerceToPositiveInteger('1e20'), '1e20');
    strictEqual(coerceToPositiveInteger(String(Number.MAX_SAFE_INTEGER + 1)), '9007199254740992');
  });
});
