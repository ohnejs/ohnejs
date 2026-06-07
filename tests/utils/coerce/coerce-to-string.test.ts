import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { coerceToString } from '../../../src/utils/index.ts';

describe('coerceToString', () => {
  it('coerces integers', () => {
    strictEqual(coerceToString(123), '123');
    strictEqual(coerceToString(-7), '-7');
    strictEqual(coerceToString(0), '0');
  });

  it('coerces decimals', () => {
    strictEqual(coerceToString(1.5), '1.5');
    strictEqual(coerceToString(-0.25), '-0.25');
  });

  it('coerces booleans', () => {
    strictEqual(coerceToString(true), 'true');
    strictEqual(coerceToString(false), 'false');
  });

  it('coerces NaN to its string form', () => {
    strictEqual(coerceToString(NaN), 'NaN');
  });

  it('returns null, undefined, objects, arrays unchanged', () => {
    strictEqual(coerceToString(null), null);
    strictEqual(coerceToString(undefined), undefined);
    const obj = { a: 1 };
    strictEqual(coerceToString(obj), obj);
    const arr = [1, 2];
    deepStrictEqual(coerceToString(arr), arr);
  });

  it('returns strings unchanged', () => {
    strictEqual(coerceToString('hi'), 'hi');
    strictEqual(coerceToString(''), '');
  });

  it('coerces bigints', () => {
    strictEqual(coerceToString(123n), '123');
    strictEqual(coerceToString(-9n), '-9');
    strictEqual(coerceToString(0n), '0');
  });
});
