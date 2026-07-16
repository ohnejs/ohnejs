/**
 * Whether a JSON text stays within `max` levels of bracket nesting, scanned without parsing.
 *
 * A linear, string-aware pass: `{` and `[` deepen, `}` and `]` surface.
 * Brackets inside a string literal do not count, and an escaped quote does not end the string.
 * Meant to run before `JSON.parse`, so a deeply nested payload is refused before it overflows the stack.
 * It judges depth only; malformed JSON that never overflows is left for the parser.
 *
 * @example
 * ```ts
 * jsonDepthWithin('{"a":[1,2]}', 2)  // -> true
 * jsonDepthWithin('[[[]]]', 2)       // -> false
 * jsonDepthWithin('{"a":"]]]]"}', 1) // -> true
 * ```
 */
export function jsonDepthWithin(text: string, max: number): boolean {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const char of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '{' || char === '[') {
      if (++depth > max) return false;
    } else if (char === '}' || char === ']') depth--;
  }
  return true;
}
