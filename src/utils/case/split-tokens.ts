/**
 * Splits a string into word tokens, preserving original casing.
 * Recognizes camelCase, acronym, and non-alphanumeric boundaries.
 *
 * Reach for it when acronym casing matters (`toCamelCase`, `toPascalCase`).
 *
 * @example
 * ```ts
 * splitTokens('BlogPosts')     // -> ['Blog', 'Posts']
 * splitTokens('HTMLParser')    // -> ['HTML', 'Parser']
 * splitTokens('parseURL')      // -> ['parse', 'URL']
 * splitTokens('blog-posts_v2') // -> ['blog', 'posts', 'v2']
 * splitTokens('')              // -> []
 * splitTokens('---')           // -> []
 * ```
 */
export function splitTokens(input: string): string[] {
  if (!input) return [];

  const withSeparators = input
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2');

  return withSeparators.split(/[^A-Za-z0-9]+/).filter((token) => token.length > 0);
}
