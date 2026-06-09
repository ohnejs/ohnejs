/**
 * Uppercases the first character; leaves the rest unchanged.
 * Empty strings pass through.
 *
 * Inverse of `uncapitalize`.
 * The tail is untouched, so it composes cleanly with already-formatted text and arbitrary tokens.
 *
 * @example
 * ```ts
 * capitalize('hello')       // -> 'Hello'
 * capitalize('Hello')       // -> 'Hello'
 * capitalize('hELLO wORLD') // -> 'HELLO wORLD'
 * capitalize('café')        // -> 'Café'
 * capitalize('')            // -> ''
 * ```
 */
export function capitalize(input: string): string {
  if (input.length === 0) return input;
  return input.charAt(0).toUpperCase() + input.slice(1);
}
