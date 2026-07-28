/**
 * Returns whether one held capability covers a required one.
 * A capability is a dot-separated string.
 * `*` covers everything, and a `.*` suffix covers every capability under its prefix.
 * Matching is literal beyond the wildcards; the required side never expands.
 *
 * @example
 * ```ts
 * capabilityCovers('collection.Posts.read', 'collection.Posts.read') // -> true
 * capabilityCovers('collection.Posts.*', 'collection.Posts.read')    // -> true
 * capabilityCovers('collection.*', 'collection.Posts.read')          // -> true
 * capabilityCovers('*', 'billing.export')                            // -> true
 * capabilityCovers('collection.Posts.read', 'collection.Posts.*')    // -> false
 * ```
 */
export function capabilityCovers(held: string, required: string): boolean {
  if (held === required || held === '*') return true;
  return held.endsWith('.*') && required.startsWith(held.slice(0, -1));
}
