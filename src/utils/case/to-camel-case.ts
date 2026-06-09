import { capitalize } from './capitalize.ts';
import { splitTokens } from './split-tokens.ts';
import { uncapitalize } from './uncapitalize.ts';

const ACRONYM = /^[A-Z][A-Z0-9]*$/;

/**
 * Converts a string to `camelCase`.
 * Casing within each token is preserved, so trailing acronyms survive.
 *
 * A leading acronym is lowercased entirely.
 * Otherwise only the first character is lowered.
 *
 * @example
 * ```ts
 * toCamelCase('blog-posts') // -> 'blogPosts'
 * toCamelCase('BlogPosts')  // -> 'blogPosts'
 * toCamelCase('HTMLParser') // -> 'htmlParser'
 * toCamelCase('parserHTML') // -> 'parserHTML'
 * toCamelCase('')           // -> ''
 * ```
 */
export function toCamelCase(input: string): string {
  const tokens = splitTokens(input);
  if (tokens.length === 0) return '';
  const [first, ...rest] = tokens;
  const head = ACRONYM.test(first!) ? first!.toLowerCase() : uncapitalize(first!);
  return head + rest.map(capitalize).join('');
}
