const ENCODED_SLASH = /%2f/i;
const ESCAPE = /%([\dA-Fa-f]{2})/g;
const UNRESERVED = /[\w\-.~]/;

/**
 * Canonicalizes a URL path per RFC 3986.
 * Escapes of unreserved characters are decoded, and other escapes get uppercase hex.
 *
 * Returns `null` when the path holds an encoded slash (`%2F`), which no segment may hide.
 * Expects a WHATWG-parsed pathname, its dot segments resolved, so decoding `%2E` cannot create one.
 *
 * @example
 * ```ts
 * canonicalPath('/%70ublic/x') // -> '/public/x'
 * canonicalPath('/caf%c3%a9')  // -> '/caf%C3%A9'
 * canonicalPath('/a%2Fb')      // -> null
 * canonicalPath('/%2570')      // -> '/%2570'
 * ```
 */
export function canonicalPath(path: string): string | null {
  if (!path.includes('%')) return path;
  if (ENCODED_SLASH.test(path)) return null;
  return path.replace(ESCAPE, (_, hex: string) => {
    const char = String.fromCharCode(Number.parseInt(hex, 16));
    return UNRESERVED.test(char) ? char : `%${hex.toUpperCase()}`;
  });
}
