const KEY = /[A-Za-z_][A-Za-z0-9_]*/y;

/**
 * Parses the contents of a `.env` file into a flat record of strings.
 *
 * Keys match `[A-Za-z_][A-Za-z0-9_]*`.
 * The first `=` on the line separates key from value.
 * Whitespace around the `=` is allowed and stripped.
 *
 * Values come in three flavors:
 * - Bare values run until end-of-line or an inline ` # comment`.
 *   Trailing whitespace is trimmed.
 *   A `#` without preceding whitespace stays part of the value (e.g. `COLOR=#fff`).
 * - Double-quoted values can span multiple lines.
 *   Escapes `\n`, `\r`, `\t`, `\\`, `\"` are interpreted.
 *   Unknown escapes drop the backslash and keep the next character.
 * - Single-quoted values are literal.
 *   Newlines and backslashes pass through unchanged.
 *
 * Blank lines and lines whose first non-whitespace character is `#` are skipped.
 * Inside any quoted value, `#` is literal.
 * Duplicate keys keep the last assignment.
 *
 * Throws on malformed input: missing `=`, unterminated quote, or non-whitespace after a closing quote.
 *
 * @example
 * ```ts
 * parseEnv('FOO=bar\nBAZ=qux')     // -> { FOO: 'bar', BAZ: 'qux' }
 * parseEnv('FOO =  hello world  ') // -> { FOO: 'hello world' }
 * parseEnv('FOO=value # comment')  // -> { FOO: 'value' }
 * parseEnv('COLOR=#fff')           // -> { COLOR: '#fff' }
 * parseEnv('NL="line1\\nline2"')   // -> { NL: 'line1\nline2' }
 * parseEnv("RAW='line1\\nline2'")  // -> { RAW: 'line1\\nline2' }
 * ```
 */
export function parseEnv(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  const len = text.length;
  let i = 0;

  while (i < len) {
    while (i < len && (text[i] === ' ' || text[i] === '\t')) i++;

    if (i >= len) break;
    if (text[i] === '\n') {
      i++;
      continue;
    }
    if (text[i] === '\r') {
      i++;
      if (i < len && text[i] === '\n') i++;
      continue;
    }
    if (text[i] === '#') {
      while (i < len && text[i] !== '\n') i++;
      continue;
    }

    KEY.lastIndex = i;
    const keyMatch = KEY.exec(text);
    if (!keyMatch) {
      throw new Error(`Invalid env: unexpected character "${text[i]}" at position ${i}`);
    }
    const key = keyMatch[0];
    i = KEY.lastIndex;

    while (i < len && (text[i] === ' ' || text[i] === '\t')) i++;
    if (text[i] !== '=') {
      throw new Error(`Invalid env: expected "=" after key "${key}"`);
    }
    i++;

    while (i < len && (text[i] === ' ' || text[i] === '\t')) i++;

    let value = '';
    const first = text[i];

    if (first === '"') {
      i++;
      while (i < len && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < len) {
          const next = text[i + 1]!;
          if (next === 'n') value += '\n';
          else if (next === 'r') value += '\r';
          else if (next === 't') value += '\t';
          else if (next === '"') value += '"';
          else if (next === '\\') value += '\\';
          else value += next;
          i += 2;
        } else {
          value += text[i];
          i++;
        }
      }
      if (i >= len) {
        throw new Error(`Invalid env: unterminated double-quoted value for "${key}"`);
      }
      i++;
      i = expectLineEnd(text, i, key);
    } else if (first === "'") {
      i++;
      const start = i;
      while (i < len && text[i] !== "'") i++;
      if (i >= len) {
        throw new Error(`Invalid env: unterminated single-quoted value for "${key}"`);
      }
      value = text.slice(start, i);
      i++;
      i = expectLineEnd(text, i, key);
    } else {
      const start = i;
      let end = -1;
      while (i < len && text[i] !== '\n') {
        if (text[i] === '#' && (text[i - 1] === ' ' || text[i - 1] === '\t')) {
          end = i;
          while (i < len && text[i] !== '\n') i++;
          break;
        }
        i++;
      }
      if (end === -1) end = i;
      value = text.slice(start, end).trimEnd();
    }

    result[key] = value;

    if (i < len && text[i] === '\n') i++;
  }

  return result;
}

/**
 * Skips a closing quote's trailing whitespace or comment to the line end, throwing on any other text.
 */
function expectLineEnd(text: string, i: number, key: string): number {
  const len = text.length;
  while (i < len && (text[i] === ' ' || text[i] === '\t' || text[i] === '\r')) i++;
  if (i < len && text[i] !== '\n' && text[i] !== '#') {
    throw new Error(`Invalid env: unexpected character after closing quote for "${key}"`);
  }
  while (i < len && text[i] !== '\n') i++;
  return i;
}
