/**
 * A manifest entry mapping a route pattern to the module URL to load when a location matches it.
 *
 * A client router matches a location against `pattern`, then dynamic-imports `url`.
 *
 * @example
 * ```ts
 * const page: PageRoute = {
 *   pattern: '/authors/[id]',
 *   url: '/pages/authors/[id].js',
 * }
 * ```
 */
export interface PageRoute {
  /**
   * The route pattern in `compileRoute` syntax, like `/`, `/about`, or `/authors/[id]`.
   */
  pattern: string;

  /**
   * The `import()`-ready URL of the page module.
   */
  url: string;
}
