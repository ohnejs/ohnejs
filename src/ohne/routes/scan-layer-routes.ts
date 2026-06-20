import type { OhneLayer } from '../project/resolve-ohne-layers.ts';

import { listDir } from '../../utils/fs/index.ts';
import { isNull, joinPath, naturalCompare, pathToRoute } from '../../utils/index.ts';
import { type RouteMeta } from './route.ts';

/**
 * Reads every route file in one layer's API directory.
 *
 * Each `.ts` file under `<layer.dir>/<api>` maps to a route via `pathToRoute`.
 * Results are sorted by file path so the output is deterministic.
 * Returns `[]` when the layer has no API directory.
 *
 * @example
 * ```ts
 * await scanLayerRoutes({ name: 'app', dir: '/app' }, 'api')
 * // -> [{ method: 'GET', pattern: '/users/[id]', file: '...', layer: 'app' }]
 * ```
 */
export async function scanLayerRoutes(layer: OhneLayer, api: string): Promise<RouteMeta[]> {
  const entries = await listDir(joinPath(layer.dir, api), { ext: 'ts', files: true });
  if (isNull(entries)) return [];

  return entries
    .sort((a, b) => naturalCompare(a.relativePath, b.relativePath))
    .map((entry) => {
      const { method, pattern } = pathToRoute(entry.relativePath);
      return { method, pattern, file: entry.path, layer: layer.name };
    });
}
