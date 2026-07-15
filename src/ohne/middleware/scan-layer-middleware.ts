import type { OhneLayer } from '../project/resolve-ohne-layers.ts';
import type { MiddlewareMeta } from './middleware.ts';

import { listDir } from '../../utils/fs/index.ts';
import {
  isNull,
  isUndefined,
  joinPath,
  naturalCompare,
  pathToKebabName,
  relativePath,
} from '../../utils/index.ts';
import { assertImportablePath } from '../codegen/assert-importable-path.ts';
import { ohneError } from '../error/ohne-error.ts';

const GLOBAL_DIR = 'global';

/**
 * Reads every middleware file in one layer's middleware directory.
 *
 * Each `.ts` file under `<layer.dir>/<middleware>` maps to a middleware, named via `pathToKebabName`.
 * A `_`-prefixed file or directory is a helper and is skipped.
 * A file inside the `global/` directory is flagged `isGlobal`, read from the raw path.
 * So a literal `global.ts` file stays named, while `global/auth.ts` is global.
 * Results are sorted by file path so the output is deterministic.
 * Returns `[]` when the layer has no middleware directory.
 * Throws when two files in the layer resolve to the same name, since one would silently shadow the other.
 *
 * @example
 * ```ts
 * await scanLayerMiddleware({ name: 'app', dir: '/app' }, 'middleware')
 * // -> [{ name: 'auth', isGlobal: false, file: '...', layer: 'app' }]
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
    .filter((entry) => !entry.relativePath.split('/').some((segment) => segment.startsWith('_')))
    .sort((a, b) => naturalCompare(a.relativePath, b.relativePath))
    .map((entry) => {
      assertImportablePath('middleware', entry.relativePath, entry.path);
      const name = pathToKebabName(entry.relativePath);
      const clash = seen.get(name);
      if (!isUndefined(clash)) {
        throw ohneError({
          title: `Duplicate middleware \`${name}\``,
          body: [
            `Two files in layer \`${layer.name}\` resolve to the same name.`,
            '',
            `- \`${relativePath(process.cwd(), clash)}\``,
            `- \`${relativePath(process.cwd(), entry.path)}\``,
          ],
        });
      }
      seen.set(name, entry.path);
      const isGlobal = entry.relativePath.startsWith(`${GLOBAL_DIR}/`);
      return { name, isGlobal, file: entry.path, layer: layer.name };
    });
}
