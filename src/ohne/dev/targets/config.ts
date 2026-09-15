import type { SetTarget } from './set-target.ts';
import type { Target } from './target.ts';

import { joinPath, normalizePath } from '../../../utils/index.ts';
import { loadLayers } from '../../layers/load-layers.ts';
import { useLayers } from '../../layers/use-layers.ts';

/**
 * The root invalidator.
 *
 * Its closure is every layer's `ohne.config.ts` and `ohne.layer.ts`.
 * On change it reloads the registry with a fresh `loadLayers`, reading past the module cache.
 * It then forces a full regen of every dependent against the fresh registry.
 * A config that fails to import leaves the previous stack intact, so `affectedBy` keeps matching.
 * A later good save then recovers.
 * The supervisor runs it first, as a barrier, so a config-only edit still rewrites every table.
 */
export function createConfigTarget(from: string, dependents: readonly SetTarget[]): Target {
  return {
    id: 'config',
    affectedBy(changedPath) {
      const path = normalizePath(changedPath);
      return useLayers()
        .layers()
        .some(
          (layer) =>
            path === joinPath(layer.path, 'ohne.config.ts') ||
            path === joinPath(layer.path, 'ohne.layer.ts'),
        );
    },
    async regen() {
      await loadLayers(from, { fresh: true });
      for (const dependent of dependents) dependent.invalidate();
      return (await Promise.all(dependents.map((dependent) => dependent.regen()))).flat();
    },
  };
}
