/**
 * Options for `indent`.
 */
export interface IndentOptions {
  /**
   * How many levels to indent by.
   *
   * @default
   * 1
   */
  level?: number;

  /**
   * Spaces per level.
   *
   * @default
   * 2
   */
  size?: number;
}

/**
 * Indents every non-empty line of `code` by `level * size` spaces.
 *
 * Blank lines are left untouched, so no trailing whitespace is introduced.
 * A non-positive `level` returns `code` unchanged.
 *
 * @example
 * ```ts
 * indent('a\nb')               // -> '  a\n  b'
 * indent('a\nb', { level: 2 }) // -> '    a\n    b'
 * indent('a\n\nb')             // -> '  a\n\n  b'
 * ```
 */
export function indent(code: string, options: IndentOptions = {}): string {
  const { level = 1, size = 2 } = options;
  if (level <= 0) return code;
  const pad = ' '.repeat(level * size);
  return code
    .split('\n')
    .map((line) => (line.length === 0 ? line : pad + line))
    .join('\n');
}
