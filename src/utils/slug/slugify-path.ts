import { slugify } from './slugify.ts';

/**
 * Converts a `/`-separated path to a slug path: each segment becomes a slug, and empty segments drop.
 * No slash survives at either end, and none repeats.
 *
 * @example
 * ```ts
 * slugifyPath('Docs / Getting Started') // -> 'docs/getting-started'
 * slugifyPath('/a//B/')                 // -> 'a/b'
 * slugifyPath('Привет')                 // -> ''
 * ```
 */
export function slugifyPath(value: string): string {
  return value
    .split('/')
    .map((segment) => slugify(segment))
    .filter(Boolean)
    .join('/');
}
