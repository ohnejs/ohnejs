const SCHEMES = new Set(['http:', 'https:']);

/**
 * Whether a server may fetch `url` on someone's behalf: `http:` or `https:`, with no userinfo.
 * Userinfo is refused because an HTTP client sends it as `Authorization: Basic`.
 *
 * @example
 * ```ts
 * isFetchableURL(new URL('https://dalaran.example/a.png'))    // -> true
 * isFetchableURL(new URL('file:///etc/passwd'))               // -> false
 * isFetchableURL(new URL('https://thrall:x@dalaran.example')) // -> false
 * ```
 */
export function isFetchableURL(url: URL): boolean {
  return SCHEMES.has(url.protocol) && url.username === '' && url.password === '';
}
