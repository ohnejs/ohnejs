import type { OhneLayer } from '../project/resolve-ohne-layers.ts';

import { joinPath } from '../../utils/index.ts';
import { DIR_DEFAULTS } from '../layers/config.ts';
import { useLayers } from '../layers/use-layers.ts';

/**
 * Resolves each layer's dashboard directory into an ordered absolute root list for `sendFile`.
 *
 * Roots are ordered closest-layer-first.
 * With `sendFile`'s first-root-wins, a closer layer's page shadows a deeper layer's same-path page.
 *
 * @example
 * ```ts
 * dashboardRoots([{ name: 'auth', dir: '/dep' }, { name: 'app', dir: '/app' }])
 * // -> ['/app/dashboard', '/dep/dashboard']
 * ```
 */
export function dashboardRoots(layers: readonly OhneLayer[]): string[] {
  const configByPath = new Map(
    useLayers()
      .layers()
      .map((layer) => [layer.path, layer.input]),
  );

  return layers
    .map((layer) =>
      joinPath(layer.dir, configByPath.get(layer.dir)?.dirs?.dashboard ?? DIR_DEFAULTS.dashboard),
    )
    .reverse();
}
