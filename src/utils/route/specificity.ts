import { naturalCompare } from '../sort/natural-compare.ts';

/**
 * Scores a route pattern's segments by specificity: a static segment `2`, `[param]` `1`, `[...rest]` `0`.
 *
 * @example
 * ```ts
 * specificity('/users/new')  // -> [2, 2]
 * specificity('/users/[id]') // -> [2, 1]
 * specificity('/[...path]')  // -> [0]
 * ```
 */
export function specificity(pattern: string): number[] {
  return pattern
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      if (segment.startsWith('[...')) return 0;
      if (segment.startsWith('[') || segment.startsWith(':')) return 1;
      return 2;
    });
}

/**
 * Compares two route patterns most-specific-first, for ranking a route table.
 * A static segment outranks a `[param]`, which outranks a `[...catch-all]`; the longer pattern wins a tie.
 * Patterns of equal specificity fall back to `naturalCompare`.
 *
 * @example
 * ```ts
 * ['/[...all]', '/users/[id]', '/users/new'].sort(compareSpecificity)
 * // -> ['/users/new', '/users/[id]', '/[...all]']
 * ```
 */
export function compareSpecificity(a: string, b: string): number {
  const sa = specificity(a);
  const sb = specificity(b);

  const shared = Math.min(sa.length, sb.length);
  for (let i = 0; i < shared; i++) {
    if (sa[i] !== sb[i]) return sb[i] - sa[i];
  }
  if (sa.length !== sb.length) return sb.length - sa.length;
  return naturalCompare(a, b);
}
