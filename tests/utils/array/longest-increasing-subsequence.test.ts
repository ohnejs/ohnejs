import { deepStrictEqual, ok } from 'node:assert';
import { describe, it } from 'node:test';

import { longestIncreasingSubsequence } from '../../../src/utils/index.ts';

const isStrictlyIncreasingRun = (items: readonly number[], indices: readonly number[]): boolean =>
  indices.every(
    (index, i) => i === 0 || (items[indices[i - 1] as number] as number) < (items[index] as number),
  );

describe('longestIncreasingSubsequence', () => {
  it('returns an empty array for empty input', () => {
    deepStrictEqual(longestIncreasingSubsequence([]), []);
  });

  it('returns the only index for a single element', () => {
    deepStrictEqual(longestIncreasingSubsequence([42]), [0]);
  });

  it('returns every index for an ascending run', () => {
    deepStrictEqual(longestIncreasingSubsequence([1, 2, 3, 4]), [0, 1, 2, 3]);
  });

  it('returns the last index for a descending run', () => {
    deepStrictEqual(longestIncreasingSubsequence([3, 2, 1]), [2]);
  });

  it('prefers the subsequence with the smallest tails', () => {
    deepStrictEqual(longestIncreasingSubsequence([2, 0, 1]), [1, 2]);
    deepStrictEqual(longestIncreasingSubsequence([5, 1, 6, 2, 7]), [1, 3, 4]);
  });

  it('returns indices that map to a strictly-increasing value run', () => {
    const items = [9, 3, 7, 1, 8, 2, 6, 4, 5, 0];
    ok(isStrictlyIncreasingRun(items, longestIncreasingSubsequence(items)));
  });
});
