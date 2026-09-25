const BARE = /^[\p{L}\p{M}\p{N}_./-]+$/u;

/**
 * Quotes `path` as one POSIX shell word that a command reads as exactly that path.
 * Letters, digits, `_`, `.`, `/`, and `-` stay bare, and anything else goes in single quotes.
 * A leading `-` or `+` gains `./`, so `cd` never reads it as an option or a directory stack entry.
 *
 * @example
 * ```ts
 * shellPath('my-app') // -> 'my-app'
 * shellPath('my app') // -> "'my app'"
 * shellPath("it's")   // -> "'it'\\''s'"
 * shellPath('-dash')  // -> './-dash'
 * ```
 */
export function shellPath(path: string): string {
  const operand = /^[-+]/.test(path) ? `./${path}` : path;
  return BARE.test(operand) ? operand : `'${operand.replaceAll("'", "'\\''")}'`;
}
