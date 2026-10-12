import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { duplicates } from '../../../src/utils/index.ts';

describe('duplicates', () => {
  it('returns each repeated value once, in the order it first repeats', () => {
    deepStrictEqual(duplicates(['b', 'a', 'a', 'b', 'a']), ['a', 'b']);
  });

  it('returns an empty array when every value is distinct', () => {
    deepStrictEqual(duplicates([1, 2, 3]), []);
    deepStrictEqual(duplicates([]), []);
  });

  it('compares by `SameValueZero`', () => {
    deepStrictEqual(duplicates([NaN, NaN, 0, -0]), [NaN, 0]);
  });
});
