import type { OhneLayer } from '../project/resolve-ohne-layers.ts';

import { listDir } from '../../utils/fs/index.ts';
import {
  isNull,
  isUndefined,
  joinPath,
  naturalCompare,
  pathToRoute,
  relativePath,
} from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';
import { routeId, type RouteMeta } from './route.ts';

/**
 * Reads every route file in one layer's API directory.
 *
 * Each `.ts` file under `<layer.dir>/<api>` maps to a route via `pathToRoute`.
 * Results are sorted by file path so the output is deterministic.
 * Returns `[]` when the layer has no API directory.
 * Throws when two files in the layer resolve to the same route, since one would silently shadow the other.
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

  const seen = new Map<string, string>();
  return entries
    .sort((a, b) => naturalCompare(a.relativePath, b.relativePath))
    .map((entry) => {
      const { method, pattern } = pathToRoute(entry.relativePath);
      const id = routeId(method, pattern);
      const clash = seen.get(id);
      if (!isUndefined(clash)) {
        throw ohneError({
          title: `Duplicate route \`${id}\``,
          body: [
            `Two files in layer \`${layer.name}\` resolve to the same route.`,
            '',
            `- \`${relativePath(process.cwd(), clash)}\``,
            `- \`${relativePath(process.cwd(), entry.path)}\``,
          ],
        });
      }
      seen.set(id, entry.path);
      return { method, pattern, file: entry.path, layer: layer.name };
    });
}
