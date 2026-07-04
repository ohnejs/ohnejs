import { isNull } from '../is/is-null.ts';
import { extname } from '../path/extname.ts';
import { normalizePath } from '../path/normalize-path.ts';
import { pathToRoutePattern } from './path-to-route-pattern.ts';

/**
 * Uppercase HTTP method name recognized as a route suffix.
 */
export type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

/**
 * A route derived from a relative path.
 */
export interface PathRoute {
  /**
   * HTTP method extracted from the filename suffix (`.get`, `.post`, ...).
   * `null` when the filename does not declare a method, meaning the route is method-agnostic.
   */
  method: HTTPMethod | null;

  /**
   * URL route pattern.
   * Always starts with `/`.
   * See `pathToRoutePattern` for the conversion rules.
   */
  pattern: string;
}

const METHOD_SUFFIX_RE = /^(.*)\.(get|post|put|patch|delete|head|options)$/i;

/**
 * Converts a relative path into a route descriptor with HTTP method.
 *
 * Recognizes a `.{method}` suffix on the basename, case-insensitively.
 * Supported methods: `get`, `post`, `put`, `patch`, `delete`, `head`, `options`.
 * When present, the method is returned uppercase and stripped from the pattern.
 * When absent, `method` is `null` and the caller decides how to dispatch.
 *
 * Pattern construction is delegated to `pathToRoutePattern`.
 *
 * @example
 * ```ts
 * pathToRoute('./foo/[bar]/index.post.ts')
 * // -> { method: 'POST', pattern: '/foo/[bar]' }
 *
 * pathToRoute('./authors/[id].get.ts')
 * // -> { method: 'GET', pattern: '/authors/[id]' }
 *
 * pathToRoute('./files/[...path].ts')
 * // -> { method: null, pattern: '/files/[...path]' }
 *
 * pathToRoute('./index.ts')
 * // -> { method: null, pattern: '/' }
 * ```
 */
export function pathToRoute(relativePath: string): PathRoute {
  const normalized = normalizePath(relativePath);
  const ext = extname(normalized);
  const withoutExt = ext.length > 0 ? normalized.slice(0, -ext.length) : normalized;

  const lastSlash = withoutExt.lastIndexOf('/');
  const base = lastSlash >= 0 ? withoutExt.slice(lastSlash + 1) : withoutExt;
  const dir = lastSlash >= 0 ? withoutExt.slice(0, lastSlash) : '';

  const methodMatch = base.match(METHOD_SUFFIX_RE);
  if (isNull(methodMatch)) {
    return { method: null, pattern: pathToRoutePattern(normalized) };
  }

  const cleanedPath = (dir.length > 0 ? dir + '/' : '') + methodMatch[1] + ext;
  return {
    method: methodMatch[2].toUpperCase() as HTTPMethod,
    pattern: pathToRoutePattern(cleanedPath),
  };
}
