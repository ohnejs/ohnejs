const ESCAPE = '\\u0000';

/**
 * Whether a JSON text decodes to a U+0000 (NUL) anywhere, in a key or a value.
 * Finds a raw NUL and a `\u0000` escape, scanned without parsing.
 * A `\u0000` counts only when the backslash before it is not itself escaped.
 * Meant for text `JSON.parse` accepted, where every backslash sits inside a string.
 *
 * @example
 * ```ts
 * jsonHasNUL('{"a":"x\\u0000"}') // -> true
 * jsonHasNUL('["\\\\u0000"]')    // -> false
 * jsonHasNUL('{"a":"x"}')        // -> false
 * ```
 */
export function jsonHasNUL(text: string): boolean {
  if (text.includes('\0')) return true;
  for (let at = text.indexOf(ESCAPE); at !== -1; at = text.indexOf(ESCAPE, at + 1)) {
    let run = 0;
    while (text[at - 1 - run] === '\\') run++;
    if (run % 2 === 0) return true;
  }
  return false;
}
