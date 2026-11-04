import { withTrailingSlash } from './with-trailing-slash.ts';

/**
 * The entry of `paths` that sits closest above `path`: the path itself, else its longest parent.
 * Paths compare by whole segments, and `/` matches only itself, since every path sits under it.
 *
 * @example
 * ```ts
 * closestPath(['/sites/a', '/sites/a/logs'], '/sites/a/logs/42') // -> '/sites/a/logs'
 * closestPath(['/sites/a', '/sites/a/logs'], '/sites/a')         // -> '/sites/a'
 * closestPath(['/sites/a'], '/sites/ab')                         // -> undefined
 * closestPath(['/', '/sites'], '/logs')                          // -> undefined
 * ```
 */
export function closestPath(paths: readonly string[], path: string): string | undefined {
  const here = withTrailingSlash(path);
  let best: string | undefined;
  for (const candidate of paths) {
    const target = withTrailingSlash(candidate);
    const holds = target === '/' ? here === '/' : here.startsWith(target);
    if (holds && candidate.length > (best?.length ?? -1)) best = candidate;
  }
  return best;
}
