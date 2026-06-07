import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { coerceToArray } from '../../../src/utils/index.ts';

describe('coerceToArray', () => {
  it('coerces a number', () => {
    deepStrictEqual(coerceToArray(1), [1]);
  });

  it('coerces a string', () => {
    deepStrictEqual(coerceToArray('a'), ['a']);
  });

  it('coerces null and undefined', () => {
    deepStrictEqual(coerceToArray(null), [null]);
    deepStrictEqual(coerceToArray(undefined), [undefined]);
  });

  it('coerces an object', () => {
    const obj = { x: 1 };
    deepStrictEqual(coerceToArray(obj), [obj]);
  });

  it('returns an array unchanged', () => {
    deepStrictEqual(coerceToArray([1, 2]), [1, 2]);
  });

  it('returns an empty array unchanged', () => {
    deepStrictEqual(coerceToArray([]), []);
  });

  it('returns the same array reference', () => {
    const input = [1, 2, 3];
    strictEqual(coerceToArray(input), input);
  });
});
