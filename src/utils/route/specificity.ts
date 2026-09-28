import { naturalCompare } from '../sort/natural-compare.ts';
import { ROUTE_PARAM_RE } from './_route-param.ts';

/**
 * Scores a route pattern's segments by specificity: a static segment `2`, `[param]` `1`, `[...rest]` `0`.
 * A segment mixing text with a param, like `[id].json`, scores half a step above the bare param.
 *
 * @example
 * ```ts
 * specificity('/authors/new')     // -> [2, 2]
 * specificity('/authors/[id]')    // -> [2, 1]
 * specificity('/posts/[id].json') // -> [2, 1.5]
 * specificity('/[...path]')       // -> [0]
 * ```
 */
export function specificity(pattern: string): number[] {
  return pattern.split('/').filter(Boolean).map(segmentSpecificity);
}

/**
 * Compares two route patterns most-specific-first, for ranking a route table.
 * A static segment outranks a `[param]`, which outranks a `[...catch-all]`; the longer pattern wins a tie.
 * Patterns of equal specificity fall back to `naturalCompare`.
 *
 * @example
 * ```ts
 * ['/[...all]', '/authors/[id]', '/authors/new'].sort(compareSpecificity)
 * // -> ['/authors/new', '/authors/[id]', '/[...all]']
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

/**
 * Scores one pattern segment for `specificity`.
 */
function segmentSpecificity(segment: string): number {
  const text = segment.replace(ROUTE_PARAM_RE, '');
  if (text === segment) return 2;
  const score = segment.includes('[...') ? 0 : 1;
  return text === '' ? score : score + 0.5;
}
