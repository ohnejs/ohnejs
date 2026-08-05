import { pathNameSegments } from '../path/path-name-segments.ts';

const COLON_PARAM_RE = /:([A-Za-z_][A-Za-z0-9_]*)/g;

/**
 * Converts a relative path into a URL route pattern.
 *
 * Segment derivation is delegated to `pathNameSegments`.
 * Backslashes are normalized, the extension is stripped, a trailing `index` segment is dropped.
 * Segments without any ASCII alphanumeric character are removed.
 *
 * Bracket (`[name]`, `[...name]`) param syntax is preserved; colon params (`:name`) normalize to it.
 * Equivalent spellings so share one pattern, colliding within a layer and overriding across layers.
 *
 * The result always starts with `/`.
 * A path that reduces to nothing becomes `/`.
 *
 * @example
 * ```ts
 * pathToRoutePattern('./foo/[bar]/index.ts') // -> '/foo/[bar]'
 * pathToRoutePattern('./foo/bar.tsx')        // -> '/foo/bar'
 * pathToRoutePattern('./[id]/posts.ts')      // -> '/[id]/posts'
 * pathToRoutePattern('./files/[...path].ts') // -> '/files/[...path]'
 * pathToRoutePattern('./authors/:id.ts')     // -> '/authors/[id]'
 * pathToRoutePattern('./index.ts')           // -> '/'
 * ```
 */
export function pathToRoutePattern(relativePath: string): string {
  return (
    '/' +
    pathNameSegments(relativePath)
      .map((segment) => segment.replace(COLON_PARAM_RE, '[$1]'))
      .join('/')
  );
}
