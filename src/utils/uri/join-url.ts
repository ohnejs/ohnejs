/**
 * Joins a URL and path segments with exactly one `/` at each seam.
 * Only the slashes at a seam are trimmed, so the scheme's `//` and the rest of the URL stay as written.
 * Empty segments are skipped.
 *
 * @example
 * ```ts
 * joinURL('https://api.anthropic.com', 'v1/messages')
 * // -> 'https://api.anthropic.com/v1/messages'
 *
 * joinURL('https://example.com/', '/v1/', 'chat')
 * // -> 'https://example.com/v1/chat'
 *
 * joinURL('https://example.com/v1/')
 * // -> 'https://example.com/v1'
 * ```
 */
export function joinURL(url: string, ...segments: string[]): string {
  const parts = segments.map((segment) => segment.replace(/^\/+|\/+$/g, '')).filter(Boolean);
  return [url.replace(/\/+$/, ''), ...parts].join('/');
}
