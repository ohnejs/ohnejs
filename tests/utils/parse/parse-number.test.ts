import { strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { parseNumber } from '../../../src/utils/index.ts';

describe('parseNumber', () => {
  it('returns finite numbers unchanged', () => {
    strictEqual(parseNumber(0), 0);
    strictEqual(parseNumber(1.5), 1.5);
    strictEqual(parseNumber(-3.14), -3.14);
  });

  it('parses decimal-shaped strings', () => {
    strictEqual(parseNumber('0'), 0);
    strictEqual(parseNumber('1.5'), 1.5);
    strictEqual(parseNumber('-1.5e3'), -1500);
    strictEqual(parseNumber('+2E+1'), 20);
    strictEqual(parseNumber('.5'), 0.5);
  });

  it('throws on out-of-range strings', () => {
    throws(() => parseNumber('1e500'), /out of finite range/);
  });

  it('throws on NaN and Infinity', () => {
    throws(() => parseNumber(NaN), /Expected number/);
    throws(() => parseNumber(Infinity), /Expected number/);
    throws(() => parseNumber(-Infinity), /Expected number/);
    throws(() => parseNumber('Infinity'), /Expected number/);
    throws(() => parseNumber('NaN'), /Expected number/);
  });

  it('throws on hex/binary/octal strings', () => {
    throws(() => parseNumber('0x10'), /Expected number/);
    throws(() => parseNumber('0b10'), /Expected number/);
    throws(() => parseNumber('0o10'), /Expected number/);
  });

  it('throws on whitespace-wrapped or empty strings', () => {
    throws(() => parseNumber(' 1 '), /Expected number/);
    throws(() => parseNumber(''), /Expected number/);
  });

  it('throws on booleans', () => {
    throws(() => parseNumber(true), /Expected number/);
    throws(() => parseNumber(false), /Expected number/);
  });

  it('throws on null, undefined, objects', () => {
    throws(() => parseNumber(null), /Expected number/);
    throws(() => parseNumber(undefined), /Expected number/);
    throws(() => parseNumber({}), /Expected number/);
    throws(() => parseNumber([1]), /Expected number/);
  });

  it('throws a descriptive error on bigints', () => {
    throws(() => parseNumber(1n), /Expected number/);
  });
});
