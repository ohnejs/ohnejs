import { slugifyPath } from './slugify-path.ts';
import { slugify } from './slugify.ts';

/**
 * The canonical form of a slug: a path of slugs when `nested`, else one slug that folds `/` into `-`.
 * An input with no Latin letter or digit gives `''`.
 *
 * @example
 * ```ts
 * canonicalSlug('AC/DC')                         // -> 'ac-dc'
 * canonicalSlug('Docs/Install', { nested: true }) // -> 'docs/install'
 * canonicalSlug('Über uns')                      // -> 'uber-uns'
 * ```
 */
export function canonicalSlug(
  value: string,
  options?: { readonly nested?: boolean | undefined },
): string {
  return options?.nested === true ? slugifyPath(value) : slugify(value);
}
