import { isUndefined } from '../is/is-undefined.ts';
import { last } from './last.ts';

/**
 * Returns the indices of a longest strictly-increasing subsequence of `items`.
 * Ties resolve toward the subsequence with the smallest tail values (patience sorting).
 *
 * Runs in `O(n log n)`.
 * It is the move-minimization primitive behind keyed list reconciliation.
 * Its indices are the elements that may stay in place while everything else moves.
 *
 * @example
 * ```ts
 * longestIncreasingSubsequence([5, 1, 6, 2, 7]) // -> [1, 3, 4]
 * longestIncreasingSubsequence([2, 0, 1])       // -> [1, 2]
 * longestIncreasingSubsequence([3, 2, 1])       // -> [2]
 * ```
 */
export function longestIncreasingSubsequence(items: readonly number[]): number[] {
  const predecessors: number[] = [];
  const tails: number[] = [];

  for (let i = 0; i < items.length; i++) {
    const value = items[i] as number;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((items[tails[mid] as number] as number) < value) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) predecessors[i] = tails[lo - 1] as number;
    tails[lo] = i;
  }

  const result: number[] = [];
  let index = last(tails);
  while (!isUndefined(index)) {
    result.push(index);
    index = predecessors[index];
  }
  return result.reverse();
}
