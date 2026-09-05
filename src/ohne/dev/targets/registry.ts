import type { SetTarget } from './set-target.ts';

import { isString } from '../../../utils/index.ts';
import { generateBrowserTSConfig } from '../../codegen/generate-browser-tsconfig.ts';
import { generateLayerCodegen } from '../../codegen/generate-layer-codegen.ts';
import { generateLayerName } from '../../codegen/generate-layer-name.ts';
import { generateResolvedConfig } from '../../codegen/generate-resolved-config.ts';

/**
 * The registry-derived types target.
 *
 * `layer-name.ts`, `resolved-config.ts`, and each layer's `codegen` files derive from the layer registry.
 * None of them maps to a watched directory.
 * The static `browser/tsconfig.json` rides along, since no watched directory maps to it either.
 * `affectedBy` never matches: only the initial full build and the config barrier reach it.
 * `invalidate` is a no-op; the generators already write only when their output changes.
 */
export function createRegistryTarget(from: string): SetTarget {
  return {
    id: 'registry',
    affectedBy() {
      return false;
    },
    async regen() {
      const written = await Promise.all([
        generateLayerName(from),
        generateResolvedConfig(from),
        generateBrowserTSConfig(from),
        generateLayerCodegen(from),
      ]);
      return written.flat().filter(isString);
    },
    invalidate() {},
  };
}
