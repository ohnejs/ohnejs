/**
 * The elements of `a` that also appear in `b`, in `a`'s order.
 * Membership is `SameValueZero`, so `NaN` matches `NaN`; duplicates in `a` are kept.
 *
 * @example
 * ```ts
 * intersection([1, 2, 3], [2, 3, 4]) // -> [2, 3]
 * intersection(['a', 'b'], ['c'])    // -> []
 * intersection([1, 1, 2], [1])       // -> [1, 1]
 * ```
 */
export function intersection<T>(a: readonly T[], b: readonly T[]): T[] {
  const set = new Set(b);
  return a.filter((value) => set.has(value));
}
