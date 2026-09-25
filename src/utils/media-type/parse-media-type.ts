/**
 * Defines `key` as an own enumerable property, so a `__proto__` key cannot reach the prototype.
 */
function assign(out: Record<string, string>, key: string, value: string): void {
  Object.defineProperty(out, key, { value, writable: true, enumerable: true, configurable: true });
}

/**
 * Reads `;`-separated `name=value` pairs into `out`, lowercasing names and keeping the first of each.
 */
function readParameters(input: string, out: Record<string, string>): void {
  const seen = new Set<string>();
  let i = 0;

  while (i < input.length) {
    while (i < input.length && (input[i] === ';' || input[i] === ' ' || input[i] === '\t')) i++;

    const nameStart = i;
    while (i < input.length && input[i] !== '=' && input[i] !== ';') i++;
    const name = input.slice(nameStart, i).trim().toLowerCase();
    if (input[i] !== '=') continue;
    i++;
    if (name === '') continue;
    while (input[i] === ' ' || input[i] === '\t') i++;

    let value: string;
    if (input[i] === '"') {
      i++;
      let buffer = '';
      while (i < input.length && input[i] !== '"') {
        if (input[i] === '\\' && i + 1 < input.length) i++;
        buffer += input[i++];
      }
      i++;
      value = buffer;
    } else {
      const valueStart = i;
      while (i < input.length && input[i] !== ';') i++;
      value = input.slice(valueStart, i).trim();
    }

    if (seen.has(name)) continue;
    seen.add(name);
    assign(out, name, value);
  }
}

/**
 * A media type parsed into its essence and parameters, per RFC 9110.
 */
export interface MediaType {
  /**
   * The lowercased `type/subtype` essence (`'text/html'`); `''` when the header is empty.
   */
  type: string;

  /**
   * Parameters keyed by lowercased name, values preserved verbatim.
   * Names are case-insensitive; values are not, so a `boundary` survives unchanged.
   */
  parameters: Record<string, string>;
}

/**
 * Parses a media type (a `Content-Type` value, one `Accept` range, ...) into essence and parameters.
 * The essence and parameter names are lowercased; parameter values are kept as written.
 *
 * Quoted-string values are unwrapped, honoring backslash escapes, so a `;` inside quotes is preserved.
 * Whitespace around `=` is tolerated: RFC 9110 allows none, but RFC 6266 does.
 * The first occurrence of a parameter name wins; later duplicates are ignored.
 * Untrusted input never throws, and a `__proto__` parameter lands as an own property.
 *
 * @example
 * ```ts
 * parseMediaType('text/HTML; charset=utf-8')
 * // -> { type: 'text/html', parameters: { charset: 'utf-8' } }
 *
 * parseMediaType('multipart/form-data; boundary="--; x"')
 * // -> { type: 'multipart/form-data', parameters: { boundary: '--; x' } }
 *
 * parseMediaType('')
 * // -> { type: '', parameters: {} }
 * ```
 */
export function parseMediaType(header: string): MediaType {
  const semicolon = header.indexOf(';');
  const type = (semicolon === -1 ? header : header.slice(0, semicolon)).trim().toLowerCase();

  const parameters: Record<string, string> = {};
  if (semicolon !== -1) readParameters(header.slice(semicolon), parameters);

  return { type, parameters };
}
