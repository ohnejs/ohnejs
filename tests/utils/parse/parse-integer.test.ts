import { strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { parseInteger } from '../../../src/utils/index.ts';

describe('parseInteger', () => {
  it('returns safe integers unchanged', () => {
    strictEqual(parseInteger(0), 0);
    strictEqual(parseInteger(42), 42);
    strictEqual(parseInteger(-7), -7);
  });

  it('parses integer-shaped strings', () => {
    strictEqual(parseInteger('0'), 0);
    strictEqual(parseInteger('123'), 123);
    strictEqual(parseInteger('-7'), -7);
    strictEqual(parseInteger('+5'), 5);
  });

  it('throws on decimals', () => {
    throws(() => parseInteger(1.5), /Expected integer/);
    throws(() => parseInteger('1.9'), /Expected integer/);
    throws(() => parseInteger('1.0'), /Expected integer/);
  });

  it('throws on exponent strings', () => {
    throws(() => parseInteger('1e3'), /Expected integer/);
  });

  it('throws on leading-zero strings', () => {
    throws(() => parseInteger('007'), /Expected integer/);
    throws(() => parseInteger('00'), /Expected integer/);
  });

  it('throws on hex/binary/octal strings', () => {
    throws(() => parseInteger('0x10'), /Expected integer/);
    throws(() => parseInteger('0b10'), /Expected integer/);
    throws(() => parseInteger('0o10'), /Expected integer/);
  });

  it('throws on whitespace-wrapped or empty strings', () => {
    throws(() => parseInteger(' 1 '), /Expected integer/);
    throws(() => parseInteger(''), /Expected integer/);
  });

  it('throws on booleans', () => {
    throws(() => parseInteger(true), /Expected integer/);
    throws(() => parseInteger(false), /Expected integer/);
  });

  it('throws on null, undefined, objects', () => {
    throws(() => parseInteger(null), /Expected integer/);
    throws(() => parseInteger(undefined), /Expected integer/);
    throws(() => parseInteger({}), /Expected integer/);
    throws(() => parseInteger([1]), /Expected integer/);
  });

  it('throws on unsafe-int-shaped strings', () => {
    throws(() => parseInteger('9007199254740992'), /out of safe range/);
    throws(() => parseInteger(String(Number.MAX_SAFE_INTEGER + 1)), /out of safe range/);
  });

  it('throws on NaN and Infinity', () => {
    throws(() => parseInteger(NaN), /Expected integer/);
    throws(() => parseInteger(Infinity), /Expected integer/);
  });

  it('throws a descriptive error on bigints', () => {
    throws(() => parseInteger(1n), /Expected integer/);
  });
});
