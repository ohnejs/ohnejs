import { isUndefined } from '../is/is-undefined.ts';

/**
 * Builds a lookup for the first index at or after `from`, below `length`, where `test` holds, else `length`.
 * The first lookup fills a table in one pass from the end, so a scan that asks at every step stays linear.
 * A lookup that never comes never tests an index.
 *
 * @example
 * ```ts
 * const odd = nextIndexes(5, (index) => index % 2 === 1)
 * odd(0) // -> 1
 * odd(2) // -> 3
 * odd(4) // -> 5
 * ```
 */
export function nextIndexes(
  length: number,
  test: (index: number) => boolean,
): (from: number) => number {
  let next: Int32Array | undefined;
  return (from) => {
    if (isUndefined(next)) {
      next = new Int32Array(length + 1).fill(length);
      for (let index = length - 1; index >= 0; index--) {
        next[index] = test(index) ? index : next[index + 1]!;
      }
    }
    return next[from] ?? length;
  };
}
