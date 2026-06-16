import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { toArray } from '../../../src/utils/index.ts';

describe('toArray', () => {
  it('wraps a number', () => {
    deepStrictEqual(toArray(1), [1]);
  });

  it('wraps a string without splitting', () => {
    deepStrictEqual(toArray('abc'), ['abc']);
  });

  it('wraps null and undefined', () => {
    deepStrictEqual(toArray(null), [null]);
    deepStrictEqual(toArray(undefined), [undefined]);
  });

  it('wraps a plain object', () => {
    const obj = { x: 1 };
    deepStrictEqual(toArray(obj), [obj]);
  });

  it('returns an array unchanged', () => {
    deepStrictEqual(toArray([1, 2]), [1, 2]);
  });

  it('returns an empty array unchanged', () => {
    deepStrictEqual(toArray([]), []);
  });

  it('returns the same array reference', () => {
    const input = [1, 2, 3];
    strictEqual(toArray(input), input);
  });

  it('spreads a Set into its values', () => {
    deepStrictEqual(toArray(new Set([1, 2, 3])), [1, 2, 3]);
  });

  it('spreads a Map into entries', () => {
    deepStrictEqual(
      toArray(
        new Map([
          ['a', 1],
          ['b', 2],
        ]),
      ),
      [
        ['a', 1],
        ['b', 2],
      ],
    );
  });

  it('spreads a generator', () => {
    function* gen() {
      yield 1;
      yield 2;
      yield 3;
    }
    deepStrictEqual(toArray(gen()), [1, 2, 3]);
  });
});
