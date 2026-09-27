import { isNull } from '../is/is-null.ts';
import { trimRoutePath } from './trim-route-path.ts';

/**
 * Captured route params, keyed by name.
 * Values are the raw matched substrings, not URI-decoded.
 */
export type RouteParams = Record<string, string>;

/**
 * Compiled URL route matcher produced by `compileRoute`.
 * Call it with a path to extract params; returns `null` on no match.
 *
 * @example
 * ```ts
 * const matcher = compileRoute('/authors/[id]')
 *
 * matcher('/authors/42')   // -> { id: '42' }
 * matcher('/authors/42/')  // -> { id: '42' }
 * matcher('/posts/1')      // -> null
 *
 * matcher.pattern          // -> '/authors/[id]'
 * matcher.params           // -> ['id']
 * ```
 */
export interface RouteMatcher {
  /**
   * Match a URL path against the compiled pattern.
   *
   * Returns captured params on match, or `null` otherwise.
   * The input path is expected to start with `/`; a single trailing `/` is tolerated.
   * Query strings and fragments must be stripped by the caller.
   */
  (path: string): RouteParams | null;

  /**
   * Normalized source pattern this matcher was built from.
   */
  readonly pattern: string;

  /**
   * Param names in the order they appear in the pattern.
   */
  readonly params: readonly string[];

  /**
   * The compiled regular expression.
   * Exposed for diagnostics.
   */
  readonly regex: RegExp;
}

const TOKEN_RE = /\[(\.\.\.)?([A-Za-z_][A-Za-z0-9_]*)\]|:([A-Za-z_][A-Za-z0-9_]*)/g;
const META_RE = /[.*+?^${}()|[\]\\]/g;

/**
 * Compiles a route pattern into a fast, reusable matcher.
 *
 * Supported syntax inside the pattern:
 * - `[name]` or `:name` for a single-segment named param.
 * - `[...name]` for a catch-all that captures one or more segments (including `/`).
 *
 * The pattern is normalized to start with `/` and strip trailing slashes.
 * On the matched path, a single trailing `/` is tolerated.
 * Compile once and reuse the matcher; the regex and param-name list are cached on it.
 *
 * @example
 * ```ts
 * compileRoute('/authors/[id]')('/authors/42')     // -> { id: '42' }
 * compileRoute('/authors/:id')('/authors/42')      // -> { id: '42' }
 * compileRoute('/files/[...path]')('/files/a/b/c') // -> { path: 'a/b/c' }
 *
 * compileRoute('/authors/[id]')('/posts/1')        // -> null
 * compileRoute('/authors/[id]')('/authors/')       // -> null
 * ```
 */
export function compileRoute(pattern: string): RouteMatcher {
  const normalized = '/' + pattern.replace(/^\/+|\/+$/g, '');
  const params: string[] = [];
  let regexSrc = '^';
  let cursor = 0;

  for (const token of normalized.matchAll(TOKEN_RE)) {
    regexSrc += normalized.slice(cursor, token.index).replace(META_RE, '\\$&');
    params.push(token[2] ?? token[3]);
    regexSrc += token[1] ? '(.+)' : '([^/]+)';
    cursor = token.index + token[0].length;
  }
  regexSrc += normalized.slice(cursor).replace(META_RE, '\\$&');
  regexSrc += '$';

  const regex = new RegExp(regexSrc);

  /**
   * Matches `path` with one trailing `/` dropped, returning each param's raw capture, or `null`.
   */
  function match(path: string): RouteParams | null {
    const m = regex.exec(trimRoutePath(path));
    if (isNull(m)) return null;
    const out: RouteParams = {};
    for (let i = 0; i < params.length; i++) {
      out[params[i]] = m[i + 1];
    }
    return out;
  }

  return Object.assign(match, { pattern: normalized, params, regex }) as RouteMatcher;
}
