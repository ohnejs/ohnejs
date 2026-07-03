import type { OhneLayer } from '../project/resolve-ohne-layers.ts';

import { basename } from '../../utils/index.ts';
import { useLayers } from './use-layers.ts';

/**
 * Returns the registered layer stack as name-and-directory pairs, furthest-first.
 * This is the config-cascaded stack `loadLayers` registered: only listed layers appear.
 * All layer content - routes, middleware, messages, dashboard - collects from it.
 * A layer registered without a name falls back to its directory name.
 */
export function stackedLayers(): OhneLayer[] {
  return useLayers()
    .layers()
    .map((layer) => ({ name: layer.name ?? basename(layer.path), dir: layer.path }));
}
