/**
 * Returns whether one held capability covers a required one.
 * A capability is a dot-separated string.
 * `*` covers everything, and a `.*` suffix covers every capability under its prefix.
 * Matching is literal beyond the wildcards; the required side never expands.
 *
 * @example
 * ```ts
 * capabilityCovers('blog.posts.read', 'blog.posts.read') // -> true
 * capabilityCovers('blog.posts.*', 'blog.posts.read')    // -> true
 * capabilityCovers('blog.*', 'blog.posts.read')          // -> true
 * capabilityCovers('*', 'billing.export')                // -> true
 * capabilityCovers('blog.posts.read', 'blog.posts.*')    // -> false
 * ```
 */
export function capabilityCovers(held: string, required: string): boolean {
  if (held === required || held === '*') return true;
  return held.endsWith('.*') && required.startsWith(held.slice(0, -1));
}
