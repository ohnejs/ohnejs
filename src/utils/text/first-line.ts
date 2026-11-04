/**
 * The first line of `text` that holds more than whitespace, trimmed.
 * Blank text gives `''`.
 *
 * @example
 * ```ts
 * firstLine('Command failed\n  at run') // -> 'Command failed'
 * firstLine('\n  ENOENT: open\r\n')     // -> 'ENOENT: open'
 * firstLine('  ')                       // -> ''
 * ```
 */
export function firstLine(text: string): string {
  return /\S.*/.exec(text)?.[0].trimEnd() ?? '';
}
