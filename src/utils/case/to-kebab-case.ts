import { splitWords } from './split-words.ts';

/**
 * Converts a string to `kebab-case`.
 * The result is always lowercase.
 *
 * @example
 * ```ts
 * toKebabCase('BlogPosts')     // -> 'blog-posts'
 * toKebabCase('featuredImage') // -> 'featured-image'
 * toKebabCase('HTMLParser')    // -> 'html-parser'
 * toKebabCase('user2FA')       // -> 'user-2-fa'
 * toKebabCase('')              // -> ''
 * ```
 */
export function toKebabCase(input: string): string {
  return splitWords(input).join('-');
}
