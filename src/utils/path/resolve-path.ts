import { isAbsolutePath } from './is-absolute-path.ts';
import { joinPath } from './join-path.ts';
import { normalizePath } from './normalize-path.ts';

/**
 * Resolves `path` against `base`, returning a normalized path.
 * An absolute `path` is normalized and returned as is, ignoring `base`.
 * A relative `path` is joined onto `base`, which defaults to `process.cwd()`.
 *
 * @example
 * ```ts
 * resolvePath('/srv/app')           // -> '/srv/app'
 * resolvePath('src/index.ts', '/a') // -> '/a/src/index.ts'
 * resolvePath('a/../b', '/root')    // -> '/root/b'
 * ```
 */
export function resolvePath(path: string, base: string = process.cwd()): string {
  return isAbsolutePath(path) ? normalizePath(path) : joinPath(base, path);
}
