import { exists } from '../../utils/fs/index.ts';
import { joinPath } from '../../utils/index.ts';

/**
 * Reports whether `dir` is the root of an ohne project.
 *
 * An ohne project is any directory with an `ohne.config.ts` file at its root.
 * A permission error while probing propagates rather than reading as `false`.
 *
 * @example
 * ```ts
 * await isOhneProject('/srv/app')        // -> true
 * await isOhneProject('/srv/app/vendor') // -> false
 * ```
 */
export async function isOhneProject(dir: string): Promise<boolean> {
  return exists(joinPath(dir, 'ohne.config.ts'));
}
