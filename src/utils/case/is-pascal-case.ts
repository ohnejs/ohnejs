const PASCAL_CASE = /^[A-Z][a-zA-Z0-9]*$/;

/**
 * Returns `true` when `input` is canonical `PascalCase`.
 * Starts with an uppercase letter, then letters and digits, no separators.
 *
 * Embedded acronyms (`HTMLParser`, `ParserHTML`) are accepted.
 * They are valid `toPascalCase` outputs.
 *
 * @example
 * ```ts
 * isPascalCase('BlogPosts')  // -> true
 * isPascalCase('Blog')       // -> true
 * isPascalCase('HTMLParser') // -> true
 * isPascalCase('blogPosts')  // -> false
 * isPascalCase('Blog-Posts') // -> false
 * isPascalCase('Blog_Posts') // -> false
 * isPascalCase('')           // -> false
 * ```
 */
export function isPascalCase(input: string): boolean {
  return PASCAL_CASE.test(input);
}
