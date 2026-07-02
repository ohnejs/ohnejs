import type { SetTarget } from './set-target.ts';

import { isString } from '../../../utils/index.ts';
import { generateLayerName } from '../../codegen/generate-layer-name.ts';
import { generateResolvedConfig } from '../../codegen/generate-resolved-config.ts';

/**
 * The registry-derived types target.
 *
 * `layer-name.ts` and `resolved-config.ts` derive from the layer registry, not from a watched directory.
 * `affectedBy` never matches: only the initial full build and the config barrier reach it.
 * `invalidate` is a no-op; both generators already write only when their output changes.
 */
export function createRegistryTarget(from: string): SetTarget {
  return {
    id: 'registry',
    affectedBy() {
      return false;
    },
    async regen() {
      const written = await Promise.all([generateLayerName(from), generateResolvedConfig(from)]);
      return written.filter(isString);
    },
    invalidate() {},
  };
}
