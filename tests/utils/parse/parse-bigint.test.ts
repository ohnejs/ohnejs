import { strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { parseBigInt } from '../../../src/utils/index.ts';

describe('parseBigInt', () => {
  it('returns bigints unchanged', () => {
    strictEqual(parseBigInt(42n), 42n);
    strictEqual(parseBigInt(0n), 0n);
  });

  it('parses safe integers', () => {
    strictEqual(parseBigInt(42), 42n);
    strictEqual(parseBigInt(-7), -7n);
    strictEqual(parseBigInt(0), 0n);
  });

  it('parses integer-shaped strings', () => {
    strictEqual(parseBigInt('123'), 123n);
    strictEqual(parseBigInt('-7'), -7n);
    strictEqual(parseBigInt('+5'), 5n);
  });

  it('throws on decimals', () => {
    throws(() => parseBigInt(1.5), /Expected bigint/);
    throws(() => parseBigInt('1.5'), /Expected bigint/);
  });

  it('throws on leading-zero strings', () => {
    throws(() => parseBigInt('007'), /Expected bigint/);
  });

  it('throws on unsafe-int numbers', () => {
    throws(() => parseBigInt(2 ** 53), /Expected bigint/);
  });

  it('throws on booleans', () => {
    throws(() => parseBigInt(true), /Expected bigint/);
    throws(() => parseBigInt(false), /Expected bigint/);
  });

  it('throws on null, undefined, objects', () => {
    throws(() => parseBigInt(null), /Expected bigint/);
    throws(() => parseBigInt(undefined), /Expected bigint/);
    throws(() => parseBigInt({}), /Expected bigint/);
  });

  it('throws on hex/binary/octal strings', () => {
    throws(() => parseBigInt('0x10'), /Expected bigint/);
  });
});
