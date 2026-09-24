import { splitWords } from './split-words.ts';

/**
 * Converts a string to `snake_case`.
 * The result is always lowercase.
 *
 * @example
 * ```ts
 * toSnakeCase('BlogPosts')     // -> 'blog_posts'
 * toSnakeCase('featuredImage') // -> 'featured_image'
 * toSnakeCase('HTMLParser')    // -> 'html_parser'
 * toSnakeCase('user2FA')       // -> 'user2_fa'
 * toSnakeCase('')              // -> ''
 * ```
 */
export function toSnakeCase(input: string): string {
  return splitWords(input).join('_');
}
