/**
 * Defines `key` as an own enumerable property, so a `__proto__` key cannot reach the prototype.
 */
function assign(out: Record<string, string>, key: string, value: string): void {
  Object.defineProperty(out, key, { value, writable: true, enumerable: true, configurable: true });
}

/**
 * Percent-decodes `raw`, or returns it unchanged when its escapes are malformed.
 */
function decode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Parses a `Cookie` request header into a map of name to value.
 * Names are trimmed; values are `decodeURIComponent`-decoded with a raw fallback.
 * A single pair of surrounding double quotes is stripped.
 *
 * The first occurrence of a name wins; later duplicates are ignored.
 * Untrusted input never throws.
 * A `__proto__` name lands as an own property, so a malicious cookie cannot pollute a prototype.
 *
 * @example
 * ```ts
 * parseCookies('id=42; theme=dark') // -> { id: '42', theme: 'dark' }
 * parseCookies('a=1; a=2')          // -> { a: '1' }
 * ```
 */
export function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  const seen = new Set<string>();

  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;

    const name = pair.slice(0, eq).trim();
    if (name === '' || seen.has(name)) continue;
    seen.add(name);

    let value = pair.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"'))
      value = value.slice(1, -1);
    assign(out, name, decode(value));
  }
  return out;
}
