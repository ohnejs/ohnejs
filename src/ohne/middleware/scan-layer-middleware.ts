import type { OhneLayer } from '../project/resolve-ohne-layers.ts';
import type { MiddlewareMeta } from './middleware.ts';

import { listDir } from '../../utils/fs/index.ts';
import {
  isNull,
  isUndefined,
  joinPath,
  naturalCompare,
  pathToKebabName,
} from '../../utils/index.ts';

/**
 * Reads every middleware file in one layer's middleware directory.
 *
 * Each `.ts` file under `<layer.dir>/<middleware>` maps to a middleware, named via `pathToKebabName`.
 * Results are sorted by file path so the output is deterministic.
 * Returns `[]` when the layer has no middleware directory.
 * Throws when two files in the layer resolve to the same name, since one would silently shadow the other.
 *
 * @example
 * ```ts
 * await scanLayerMiddleware({ name: 'app', dir: '/app' }, 'middleware')
 * // -> [{ name: 'auth', file: '/app/middleware/auth.ts', layer: 'app' }]
 * ```
 */
export async function scanLayerMiddleware(
  layer: OhneLayer,
  middleware: string,
): Promise<MiddlewareMeta[]> {
  const entries = await listDir(joinPath(layer.dir, middleware), { ext: 'ts', files: true });
  if (isNull(entries)) return [];

  const seen = new Map<string, string>();
  return entries
    .sort((a, b) => naturalCompare(a.relativePath, b.relativePath))
    .map((entry) => {
      const name = pathToKebabName(entry.relativePath);
      const clash = seen.get(name);
      if (!isUndefined(clash)) {
        throw new Error(
          `Duplicate middleware name "${name}" in layer "${layer.name}": "${clash}" and "${entry.path}" resolve to the same name.`,
        );
      }
      seen.set(name, entry.path);
      return { name, file: entry.path, layer: layer.name };
    });
}
