import { parseMediaType } from '../media-type/parse-media-type.ts';
import { mediaCategory } from './media-category.ts';

/**
 * Reports whether a media type matches one of `patterns`.
 *
 * A pattern is an exact type (`image/png`), a wildcard (`image/*`), or a category name (`document`).
 * A category name is matched through `mediaCategory`.
 * `'*'` as the whole argument, or as a pattern, matches every type.
 * Parameters and case are ignored, so `text/HTML; charset=utf-8` matches `text/html`.
 *
 * @example
 * ```ts
 * mediaTypeMatches('image/png', ['image/*'])          // -> true
 * mediaTypeMatches('application/pdf', ['document'])   // -> true
 * mediaTypeMatches('video/mp4', ['image', 'audio/*']) // -> false
 * mediaTypeMatches('video/mp4', '*')                  // -> true
 * ```
 */
export function mediaTypeMatches(type: string, patterns: '*' | readonly string[]): boolean {
  if (patterns === '*') return true;
  const essence = parseMediaType(type).type;
  const [topLevel] = essence.split('/');
  return patterns.some((pattern) => {
    const wanted = pattern.trim().toLowerCase();
    if (wanted === '*' || wanted === '*/*') return true;
    if (wanted.endsWith('/*')) return wanted.slice(0, -2) === topLevel;
    if (wanted.includes('/')) return wanted === essence;
    return mediaCategory(essence) === wanted;
  });
}
