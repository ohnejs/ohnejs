import type { OhneLayer } from '../project/resolve-ohne-layers.ts';
import type { MiddlewareMeta } from './middleware.ts';

import { naturalCompare } from '../../utils/index.ts';
import { DIR_DEFAULTS } from '../layers/config.ts';
import { useLayers } from '../layers/use-layers.ts';
import { scanLayerMiddleware } from './scan-layer-middleware.ts';

/**
 * Combines the middleware of every layer into one ordered list.
 *
 * Each layer is scanned in its own `dirs.middleware` directory (default `'middleware'`).
 * The value never comes from the cross-layer merge, so one layer cannot relocate another's middleware.
 *
 * Layers are scanned in order: when two resolve the same name, the closer layer wins.
 * The result is sorted by name, which is also the order middleware runs in - prefix a file to order it.
 *
 * @example
 * ```ts
 * await collectMiddleware([
 *   { name: 'base', dir: '/base' },
 *   { name: 'app', dir: '/app' },
 * ])
 * // -> [{ name: '10-auth', ... }, { name: '20-locale', ... }]
 * ```
 */
export async function collectMiddleware(layers: readonly OhneLayer[]): Promise<MiddlewareMeta[]> {
  const configByPath = new Map(
    useLayers()
      .layers()
      .map((layer) => [layer.path, layer.input]),
  );

  const table = new Map<string, MiddlewareMeta>();
  for (const layer of layers) {
    const dir = configByPath.get(layer.dir)?.dirs?.middleware ?? DIR_DEFAULTS.middleware;
    for (const middleware of await scanLayerMiddleware(layer, dir)) {
      table.set(middleware.name, middleware);
    }
  }

  return [...table.values()].sort((a, b) => naturalCompare(a.name, b.name));
}
