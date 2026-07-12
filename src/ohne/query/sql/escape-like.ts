/**
 * Escapes the `LIKE` metacharacters - backslash, `%`, `_` - with a backslash.
 * The result matches itself literally inside a `textMatch` pattern, whose escape character is `\`.
 * One pass escapes each character exactly once, so an escape never re-escapes.
 *
 * @example
 * ```ts
 * escapeLike('100%')    // -> '100\\%'
 * escapeLike('a_b')     // -> 'a\\_b'
 * escapeLike('C:\\dir') // -> 'C:\\\\dir'
 * ```
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}
