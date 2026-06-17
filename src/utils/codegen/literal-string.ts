const ESCAPES: Record<string, string> = {
  '\\': '\\\\',
  "'": "\\'",
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
};

const ESCAPE_PATTERN = /[\\'\n\r\t\u2028\u2029]/g;

/**
 * Wraps `value` in a single-quoted JavaScript string literal, escaping what would break it.
 *
 * Escapes backslashes, single quotes, and tabs.
 * It also escapes every line terminator: `\n`, `\r`, and the U+2028 / U+2029 separators.
 * Use it when embedding arbitrary text like file paths or keys into generated source.
 * A stray quote or a Windows backslash then cannot produce invalid code.
 *
 * @example
 * ```ts
 * literalString('./pages/index.ts') // -> "'./pages/index.ts'"
 * literalString("it's")             // -> "'it\\'s'"
 * literalString('C:\\app')          // -> "'C:\\\\app'"
 * ```
 */
export function literalString(value: string): string {
  return `'${value.replace(ESCAPE_PATTERN, (char) => ESCAPES[char]!)}'`;
}
