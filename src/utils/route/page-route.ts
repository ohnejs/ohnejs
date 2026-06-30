/**
 * A manifest entry mapping a route pattern to the served module URL to load when a location matches it.
 *
 * A route scan produces these.
 * A client router matches a location against `pattern`, then dynamic-imports `url`.
 *
 * @example
 * ```ts
 * const page: PageRoute = { pattern: '/users/[id]', url: '/m/app/pages/users/[id].ts' }
 * ```
 */
export interface PageRoute {
  /**
   * The route pattern, in the same syntax as the API route files (`/`, `/about`, `/users/[id]`).
   */
  pattern: string;

  /**
   * The `import()`-ready served URL of the page module.
   */
  url: string;
}
