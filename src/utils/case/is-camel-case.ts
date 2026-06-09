const CAMEL_CASE = /^[a-z][a-zA-Z0-9]*$/;

/**
 * Returns `true` when `input` is canonical `camelCase`.
 * Starts with a lowercase letter, then letters and digits, no separators.
 *
 * Trailing acronyms (`parseURL`, `userID`) are accepted.
 * They are valid `toCamelCase` outputs.
 *
 * @example
 * ```ts
 * isCamelCase('blogPosts')  // -> true
 * isCamelCase('blog')       // -> true
 * isCamelCase('parseURL')   // -> true
 * isCamelCase('BlogPosts')  // -> false
 * isCamelCase('blog-posts') // -> false
 * isCamelCase('blog_posts') // -> false
 * isCamelCase('')           // -> false
 * ```
 */
export function isCamelCase(input: string): boolean {
  return CAMEL_CASE.test(input);
}
