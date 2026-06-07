import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { coerceToBigInt } from '../../../src/utils/index.ts';

describe('coerceToBigInt', () => {
  it('returns bigints unchanged', () => {
    strictEqual(coerceToBigInt(42n), 42n);
    strictEqual(coerceToBigInt(0n), 0n);
  });

  it('coerces safe-integer numbers', () => {
    strictEqual(coerceToBigInt(42), 42n);
    strictEqual(coerceToBigInt(0), 0n);
    strictEqual(coerceToBigInt(-9), -9n);
  });

  it('coerces integer-shaped strings', () => {
    strictEqual(coerceToBigInt('123'), 123n);
    strictEqual(coerceToBigInt('-9'), -9n);
    strictEqual(coerceToBigInt('0'), 0n);
  });

  it('coerces booleans to 1n / 0n', () => {
    strictEqual(coerceToBigInt(true), 1n);
    strictEqual(coerceToBigInt(false), 0n);
  });

  it('returns decimal strings unchanged', () => {
    strictEqual(coerceToBigInt('1.5'), '1.5');
    strictEqual(coerceToBigInt('0.0'), '0.0');
  });

  it('returns non-integer numbers unchanged', () => {
    strictEqual(coerceToBigInt(1.5), 1.5);
  });

  it('returns unsafe-integer numbers unchanged', () => {
    strictEqual(coerceToBigInt(Number.MAX_SAFE_INTEGER + 1), Number.MAX_SAFE_INTEGER + 1);
  });

  it('returns non-integer-shaped strings unchanged', () => {
    strictEqual(coerceToBigInt('abc'), 'abc');
    strictEqual(coerceToBigInt(''), '');
    strictEqual(coerceToBigInt('1e10'), '1e10');
  });

  it('returns null, undefined, objects unchanged', () => {
    strictEqual(coerceToBigInt(null), null);
    strictEqual(coerceToBigInt(undefined), undefined);
    const obj = { a: 1 };
    strictEqual(coerceToBigInt(obj), obj);
  });

  it('accepts leading `+`', () => {
    strictEqual(coerceToBigInt('+5'), 5n);
    strictEqual(coerceToBigInt('+0'), 0n);
  });

  it('returns leading-zero strings unchanged', () => {
    strictEqual(coerceToBigInt('007'), '007');
    strictEqual(coerceToBigInt('-007'), '-007');
  });

  it('returns overlong strings unchanged', () => {
    const huge = '9'.repeat(1025);
    strictEqual(coerceToBigInt(huge), huge);
  });
});
