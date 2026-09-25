const CONTROL = /\p{Cc}/gu;

const NAMED: Readonly<Record<string, string>> = {
  '\b': '\\b',
  '\t': '\\t',
  '\n': '\\n',
  '\f': '\\f',
  '\r': '\\r',
};

/**
 * Spells out each control character in `text`, so a terminal shows it instead of acting on it.
 * The control characters are C0, `DEL` and C1, each written the way `util.inspect` writes it.
 * Backslashes pass through, so escaping twice changes nothing.
 *
 * @example
 * ```ts
 * escapeControls('a.txt')         // -> 'a.txt'
 * escapeControls('a\x1b[2Jb.txt') // -> 'a\\x1B[2Jb.txt'
 * escapeControls('yes\r\n')       // -> 'yes\\r\\n'
 * escapeControls('\u009b31m')     // -> '\\x9B31m'
 * ```
 */
export function escapeControls(text: string): string {
  return text.replace(
    CONTROL,
    (char) => NAMED[char] ?? `\\x${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`,
  );
}
