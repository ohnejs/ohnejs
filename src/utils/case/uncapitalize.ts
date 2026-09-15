/**
 * Lowercases the first character; leaves the rest unchanged.
 * Empty strings pass through.
 *
 * Inverse of `capitalize`.
 *
 * @example
 * ```ts
 * uncapitalize('Hello')       // -> 'hello'
 * uncapitalize('hello')       // -> 'hello'
 * uncapitalize('HELLO WORLD') // -> 'hELLO WORLD'
 * uncapitalize('')            // -> ''
 * ```
 */
export function uncapitalize(input: string): string {
  if (input.length === 0) return input;
  return input.charAt(0).toLowerCase() + input.slice(1);
}
