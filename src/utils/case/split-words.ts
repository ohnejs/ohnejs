import { splitTokens } from './split-tokens.ts';

/**
 * Splits a string into lowercase word tokens.
 * Same boundaries as `splitTokens`, then each token is lowercased.
 *
 * Used by `toKebabCase` and `toSnakeCase`.
 * Use `splitTokens` instead when casing matters (`toCamelCase`, `toPascalCase`).
 *
 * @example
 * ```ts
 * splitWords('BlogPosts')      // -> ['blog', 'posts']
 * splitWords('blog-posts')     // -> ['blog', 'posts']
 * splitWords('BlogHTMLParser') // -> ['blog', 'html', 'parser']
 * splitWords('user2FA')        // -> ['user', '2', 'fa']
 * splitWords('')               // -> []
 * ```
 */
export function splitWords(input: string): string[] {
  return splitTokens(input).map((token) => token.toLowerCase());
}
