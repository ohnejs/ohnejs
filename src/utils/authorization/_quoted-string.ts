/**
 * Wraps `text` in double quotes as an RFC 9110 quoted-string, escaping each quote and backslash inside.
 */
export function quotedString(text: string): string {
  return `"${text.replace(/["\\]/g, '\\$&')}"`;
}
