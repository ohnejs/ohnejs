import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { nextIndexes } from '../../../src/utils/array/next-indexes.ts';

describe('nextIndexes', () => {
  it('finds the first match at or after each index', () => {
    const odd = nextIndexes(5, (index) => index % 2 === 1);
    deepStrictEqual([0, 1, 2, 3, 4].map(odd), [1, 1, 3, 3, 5]);
  });

  it('gives `length` past the last match and beyond the end', () => {
    const first = nextIndexes(3, (index) => index === 0);
    deepStrictEqual([0, 1, 3, 9].map(first), [0, 3, 3, 3]);
    strictEqual(nextIndexes(0, () => true)(0), 0);
  });

  it('tests no index until the first lookup', () => {
    const tested: number[] = [];
    const find = nextIndexes(3, (index) => tested.push(index) > 3);
    deepStrictEqual(tested, []);
    find(0);
    find(1);
    deepStrictEqual(tested, [2, 1, 0]);
  });
});
