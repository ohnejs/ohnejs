import { isFunction } from '../is/is-function.ts';
import { isAbsolutePath } from './is-absolute-path.ts';
import { joinPath } from './join-path.ts';
import { normalizePath } from './normalize-path.ts';

/**
 * The working directory where the runtime exposes one, or `/` where it does not.
 * Reached through `globalThis` so browser type-checking never sees Node's `process` global.
 */
function workingDir(): string {
  const cwd = (globalThis as { process?: { cwd?: () => string } }).process?.cwd;
  return isFunction(cwd) ? cwd() : '/';
}

/**
 * Resolves `path` against `base`, returning a normalized path.
 * An absolute `path` is normalized and returned as is, ignoring `base`.
 * A relative `path` is joined onto `base`, which defaults to the working directory.
 *
 * @example
 * ```ts
 * resolvePath('/srv/app')           // -> '/srv/app'
 * resolvePath('src/index.ts', '/a') // -> '/a/src/index.ts'
 * resolvePath('a/../b', '/root')    // -> '/root/b'
 * ```
 */
export function resolvePath(path: string, base: string = workingDir()): string {
  return isAbsolutePath(path) ? normalizePath(path) : joinPath(base, path);
}
