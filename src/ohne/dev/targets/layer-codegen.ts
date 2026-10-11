import type { Target } from './target.ts';

import { generateLayerCodegen } from '../../codegen/generate-layer-codegen.ts';

/**
 * The layer codegen target, which also knows the files it generates.
 */
export interface LayerCodegenTarget extends Target {
  /**
   * Whether `path` is a file the last `regen` generated.
   */
  owns(path: string): boolean;
}

/**
 * The layer codegen target: every file the stacked layers declare under `codegen`.
 *
 * An entry may read the whole stack, its schema included, so no single directory is its closure.
 * `affectedBy` never matches; the supervisor runs it after any batch in which another target ran.
 * It runs alone, after the others, since it swaps the registries they read.
 * Definitions re-import fresh, and each entry's `code` is told to, so an edit is read again.
 * Project-path entries are written too, as `ohne prepare` writes them.
 * A path entry may land in a watched directory, so `owns` lets the supervisor skip its echo.
 */
export function createLayerCodegenTarget(from: string): LayerCodegenTarget {
  let owned = new Set<string>();
  return {
    id: 'layer-codegen',
    affectedBy() {
      return false;
    },
    async regen() {
      const paths = await generateLayerCodegen(from, { fresh: true, paths: true });
      owned = new Set(paths);
      return paths;
    },
    owns(path) {
      return owned.has(path);
    },
  };
}
