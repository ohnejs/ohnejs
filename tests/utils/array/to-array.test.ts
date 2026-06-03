import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { toArray } from '../../../src/utils/index.ts';

describe('toArray', () => {
  it('wraps a number', () => {
    deepStrictEqual(toArray(1), [1]);
  });

  it('wraps a string', () => {
    deepStrictEqual(toArray('a'), ['a']);
  });

  it('wraps null and undefined', () => {
    deepStrictEqual(toArray(null), [null]);
    deepStrictEqual(toArray(undefined), [undefined]);
  });

  it('wraps an object', () => {
    const obj = { x: 1 };
    deepStrictEqual(toArray(obj), [obj]);
  });

  it('returns an array unchanged', () => {
    deepStrictEqual(toArray([1, 2]), [1, 2]);
  });

  it('returns an empty array unchanged', () => {
    deepStrictEqual(toArray([]), []);
  });

  it('returns the same array reference (no copy)', () => {
    const input = [1, 2, 3];
    strictEqual(toArray(input), input);
  });
});
