import { strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { parsePositiveInteger } from '../../../src/utils/index.ts';

describe('parsePositiveInteger', () => {
  it('returns positive safe integers unchanged', () => {
    strictEqual(parsePositiveInteger(1), 1);
    strictEqual(parsePositiveInteger(42), 42);
  });

  it('parses positive-integer-shaped strings', () => {
    strictEqual(parsePositiveInteger('1'), 1);
    strictEqual(parsePositiveInteger('123'), 123);
    strictEqual(parsePositiveInteger('+5'), 5);
  });

  it('throws on zero', () => {
    throws(() => parsePositiveInteger(0), /Expected positive integer/);
    throws(() => parsePositiveInteger('0'), /Expected positive integer/);
  });

  it('throws on negatives', () => {
    throws(() => parsePositiveInteger(-1), /Expected positive integer/);
    throws(() => parsePositiveInteger('-7'), /Expected positive integer/);
  });

  it('throws on decimals', () => {
    throws(() => parsePositiveInteger(1.5), /Expected positive integer/);
    throws(() => parsePositiveInteger('1.9'), /Expected positive integer/);
    throws(() => parsePositiveInteger('1.0'), /Expected positive integer/);
  });

  it('throws on exponent strings', () => {
    throws(() => parsePositiveInteger('1e3'), /Expected positive integer/);
  });

  it('throws on leading-zero strings', () => {
    throws(() => parsePositiveInteger('007'), /Expected positive integer/);
    throws(() => parsePositiveInteger('01'), /Expected positive integer/);
  });

  it('throws on hex/binary/octal strings', () => {
    throws(() => parsePositiveInteger('0x10'), /Expected positive integer/);
    throws(() => parsePositiveInteger('0b10'), /Expected positive integer/);
    throws(() => parsePositiveInteger('0o10'), /Expected positive integer/);
  });

  it('throws on whitespace-wrapped or empty strings', () => {
    throws(() => parsePositiveInteger(' 1 '), /Expected positive integer/);
    throws(() => parsePositiveInteger(''), /Expected positive integer/);
  });

  it('throws on booleans', () => {
    throws(() => parsePositiveInteger(true), /Expected positive integer/);
    throws(() => parsePositiveInteger(false), /Expected positive integer/);
  });

  it('throws on null, undefined, objects', () => {
    throws(() => parsePositiveInteger(null), /Expected positive integer/);
    throws(() => parsePositiveInteger(undefined), /Expected positive integer/);
    throws(() => parsePositiveInteger({}), /Expected positive integer/);
    throws(() => parsePositiveInteger([1]), /Expected positive integer/);
  });

  it('throws on unsafe-int-shaped strings', () => {
    throws(() => parsePositiveInteger('9007199254740992'), /Expected positive integer/);
    throws(
      () => parsePositiveInteger(String(Number.MAX_SAFE_INTEGER + 1)),
      /Expected positive integer/,
    );
  });

  it('throws on NaN and Infinity', () => {
    throws(() => parsePositiveInteger(NaN), /Expected positive integer/);
    throws(() => parsePositiveInteger(Infinity), /Expected positive integer/);
  });

  it('throws on bigints', () => {
    throws(() => parsePositiveInteger(1n), /Expected positive integer/);
  });
});
