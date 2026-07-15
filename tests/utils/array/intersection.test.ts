import { deepStrictEqual, notStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { intersection } from '../../../src/utils/index.ts';

describe('intersection', () => {
  it('keeps elements present in both, in the first array order', () => {
    deepStrictEqual(intersection([1, 2, 3], [2, 3, 4]), [2, 3]);
  });

  it('returns an empty array when nothing is shared', () => {
    deepStrictEqual(intersection(['a', 'b'], ['c']), []);
  });

  it('keeps duplicates from the first array', () => {
    deepStrictEqual(intersection([1, 1, 2], [1]), [1, 1]);
  });

  it('matches `NaN`', () => {
    deepStrictEqual(intersection([NaN, 1], [NaN]), [NaN]);
  });

  it('returns an empty array when either side is empty', () => {
    deepStrictEqual(intersection([], [1]), []);
    deepStrictEqual(intersection([1], []), []);
  });

  it('returns a new array (no mutation)', () => {
    const input = [1, 2, 3];
    const output = intersection(input, [1, 2, 3]);
    notStrictEqual(output, input);
    deepStrictEqual(input, [1, 2, 3]);
  });
});
