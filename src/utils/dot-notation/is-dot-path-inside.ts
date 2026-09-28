/**
 * Checks whether the dot-notation `path` is `parent` itself or nested anywhere beneath it.
 * A boundary is a `.key` or a `[n]` segment, so a parent never matches a longer sibling name.
 *
 * @example
 * ```ts
 * isDotPathInside('items[0].slug', 'items')    // -> true
 * isDotPathInside('items.slug', 'items')       // -> true
 * isDotPathInside('items', 'items')            // -> true
 * isDotPathInside('itemsCount', 'items')       // -> false
 * isDotPathInside('items', 'items[0]')         // -> false
 * isDotPathInside('items[0].slug', 'items[0]') // -> true
 * ```
 */
export function isDotPathInside(path: string, parent: string): boolean {
  return path === parent || path.startsWith(`${parent}.`) || path.startsWith(`${parent}[`);
}
