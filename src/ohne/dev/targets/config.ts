import type { SetTarget } from './set-target.ts';
import type { Target } from './target.ts';

import { joinPath, normalizePath } from '../../../utils/index.ts';
import { loadLayers } from '../../layers/load-layers.ts';
import { useLayers } from '../../layers/use-layers.ts';

/**
 * The root invalidator.
 *
 * Its closure is every layer's `ohne.config.ts`.
 * On change it refreshes the registry: `clear`, then a fresh `loadLayers` reads past the module cache.
 * It invalidates each dependent so the next cycle regenerates against the fresh registry.
 * The supervisor runs it first, as a barrier.
 */
export function createConfigTarget(from: string, dependents: readonly SetTarget[]): Target {
  return {
    id: 'config',
    affectedBy(changedPath) {
      const path = normalizePath(changedPath);
      return useLayers()
        .layers()
        .some((layer) => path === joinPath(layer.path, 'ohne.config.ts'));
    },
    async regen() {
      useLayers().clear();
      await loadLayers(from, { fresh: true });
      for (const dependent of dependents) dependent.invalidate();
    },
  };
}
