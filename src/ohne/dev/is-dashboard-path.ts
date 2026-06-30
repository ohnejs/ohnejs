import { isPathInside, joinPath } from '../../utils/index.ts';
import { DIR_DEFAULTS } from '../layers/config.ts';
import { useLayers } from '../layers/use-layers.ts';

/**
 * Whether `changedPath` lies inside any live layer's dashboard directory.
 * The dev supervisor uses it to keep a dashboard edit from reloading the API child.
 */
export function isDashboardPath(changedPath: string): boolean {
  return useLayers()
    .layers()
    .some((layer) =>
      isPathInside(
        changedPath,
        joinPath(layer.path, layer.input.dirs?.dashboard ?? DIR_DEFAULTS.dashboard),
      ),
    );
}
