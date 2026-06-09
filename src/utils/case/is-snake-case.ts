const SNAKE_CASE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

/**
 * Returns `true` when `input` is canonical `snake_case`.
 * Lowercase-alphanumeric segments joined by single underscores.
 * No leading or trailing underscore, no empty segments.
 *
 * @example
 * ```ts
 * isSnakeCase('blog_posts')  // -> true
 * isSnakeCase('blog')        // -> true
 * isSnakeCase('blogPosts')   // -> false
 * isSnakeCase('blog__posts') // -> false
 * isSnakeCase('_blog')       // -> false
 * isSnakeCase('')            // -> false
 * ```
 */
export function isSnakeCase(input: string): boolean {
  return SNAKE_CASE.test(input);
}
