/**
 * A route id split into its method and path.
 */
export interface ParsedRouteID {
  /**
   * The HTTP method parsed off the id, absent when the id is a bare path.
   */
  method?: string;

  /**
   * The path portion of the id.
   * Starts with `/` for a real route id; a slashless id is returned unchanged.
   */
  path: string;
}

/**
 * Splits a route id into its method and path.
 * A route id is either `'{METHOD} {path}'` or a bare `path`.
 * A leading token before the path becomes the method; a bare path yields no method.
 *
 * The split anchors on the `' /'` that precedes the path.
 * So an id with neither a method nor a leading `/` is returned whole as the path, never truncated.
 *
 * @example
 * ```ts
 * parseRouteID('GET /authors/[id]') // -> { method: 'GET', path: '/authors/[id]' }
 * parseRouteID('/health')           // -> { path: '/health' }
 * parseRouteID('search')            // -> { path: 'search' }
 * ```
 */
export function parseRouteID(id: string): ParsedRouteID {
  const separator = id.startsWith('/') ? -1 : id.indexOf(' /');
  if (separator === -1) return { path: id };
  return { method: id.slice(0, separator), path: id.slice(separator + 1) };
}
