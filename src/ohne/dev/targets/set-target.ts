import type { Target } from './target.ts';

import { isNull, isPathInside, joinPath, toArray } from '../../../utils/index.ts';
import { DIR_DEFAULTS } from '../../layers/config.ts';
import { useLayers } from '../../layers/use-layers.ts';

/**
 * A set-based `Target` whose snapshot the config target can reset.
 *
 * `invalidate` drops the file-set snapshot so the next `regen` writes unconditionally.
 * That is how a config change forces a full regen even when no source file moved.
 */
export interface SetTarget extends Target {
  /**
   * Drops the file-set snapshot, forcing the next `regen` to write.
   */
  invalidate(): void;
}

/**
 * Builds a set-based target: one whose output depends only on a set of files, never their contents.
 *
 * The closure is each registered layer's `dir`: its configured `dirs[dir]`, else the default.
 * `affectedBy` is containment against those dirs.
 * `regen` recomputes the file set with `files`, skips the write when unchanged, else calls `generate`.
 * `invalidate` drops the snapshot so the next `regen` writes unconditionally.
 */
export function createSetTarget(
  id: string,
  from: string,
  dir: 'api' | 'middleware' | 'roles',
  files: (from: string) => Promise<Set<string>>,
  generate: (from: string) => Promise<string | string[] | null>,
): SetTarget {
  let snapshot: Set<string> | null = null;

  return {
    id,
    affectedBy(changedPath) {
      return useLayers()
        .layers()
        .some((layer) =>
          isPathInside(
            changedPath,
            joinPath(layer.path, layer.input.dirs?.[dir] ?? DIR_DEFAULTS[dir]),
          ),
        );
    },
    async regen() {
      const current = await files(from);
      if (!isNull(snapshot) && sameSet(snapshot, current)) return [];
      snapshot = current;
      const written = await generate(from);
      return isNull(written) ? [] : toArray(written);
    },
    invalidate() {
      snapshot = null;
    },
  };
}

/**
 * Whether `a` and `b` hold the same members, regardless of insertion order.
 */
function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}
