import { compileGlob } from '../glob/compile-glob.ts';

/**
 * Builds a predicate that tells whether a hostname matches any of the allowed patterns.
 * Each pattern is a `compileGlob` glob, so `'*.example.com'` matches any subdomain (not the apex).
 * Matching is case-insensitive; patterns and the tested hostname are lowercased.
 *
 * An empty list matches nothing.
 * The caller decides what an empty allowlist means.
 *
 * @example
 * ```ts
 * const allowed = createHostMatcher(['example.com', '*.example.com'])
 *
 * allowed('example.com')     // -> true
 * allowed('api.example.com') // -> true
 * allowed('evil.com')        // -> false
 * ```
 */
export function createHostMatcher(patterns: string[]): (hostname: string) => boolean {
  const matchers = patterns.map((pattern) => compileGlob(pattern.toLowerCase()));
  return (hostname) => {
    const lower = hostname.toLowerCase();
    return matchers.some((match) => match(lower));
  };
}
