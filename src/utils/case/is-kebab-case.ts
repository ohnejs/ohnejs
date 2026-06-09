const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Returns `true` when `input` is canonical `kebab-case`.
 * Lowercase-alphanumeric segments joined by single hyphens.
 * No leading or trailing hyphen, no empty segments.
 *
 * @example
 * ```ts
 * isKebabCase('blog-posts')  // -> true
 * isKebabCase('blog')        // -> true
 * isKebabCase('blogPosts')   // -> false
 * isKebabCase('blog--posts') // -> false
 * isKebabCase('-blog')       // -> false
 * isKebabCase('')            // -> false
 * ```
 */
export function isKebabCase(input: string): boolean {
  return KEBAB_CASE.test(input);
}
