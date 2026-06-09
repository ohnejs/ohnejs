import { capitalize } from './capitalize.ts';
import { splitTokens } from './split-tokens.ts';

/**
 * Converts a string to `PascalCase`.
 * Casing within each token is preserved, so acronyms survive in any position.
 *
 * @example
 * ```ts
 * toPascalCase('blog-posts') // -> 'BlogPosts'
 * toPascalCase('blogPosts')  // -> 'BlogPosts'
 * toPascalCase('HTMLParser') // -> 'HTMLParser'
 * toPascalCase('parserHTML') // -> 'ParserHTML'
 * toPascalCase('')           // -> ''
 * ```
 */
export function toPascalCase(input: string): string {
  return splitTokens(input).map(capitalize).join('');
}
