import type { OhneLayer } from '../project/resolve-ohne-layers.ts';

import { listDir } from '../../utils/fs/index.ts';
import { isNull, isUndefined, joinPath, naturalCompare, relativePath } from '../../utils/index.ts';
import { assertImportablePath } from '../codegen/assert-importable-path.ts';
import { validateCollectionName } from '../database/naming/validate-names.ts';
import { ohneError } from '../error/ohne-error.ts';

/**
 * One collection file found in a layer, before its definition is imported.
 */
export interface ScannedCollection {
  /**
   * The collection name: the file's stem, PascalCase.
   */
  name: string;

  /**
   * Absolute path of the file that default-exports the definition.
   */
  file: string;
}

/**
 * Reads every collection file in one layer's collections directory.
 *
 * Each `.ts` file under `<layer.dir>/<collections>` is one collection named by its stem.
 * A subdirectory only organizes files; it never contributes to the name.
 * Two files sharing a stem therefore collide and throw, naming both.
 * A `_`-prefixed file or directory is a helper and is skipped.
 * Names are validated as they are read, so a bad file name fails here, naming the file.
 * Results sort by file name; returns `[]` when the layer has no collections directory.
 *
 * @example
 * ```ts
 * await scanLayerCollections({ name: 'app', dir: '/app' }, 'collections')
 * // -> [{ name: 'Posts', file: '/app/collections/Posts.ts' }]
 * ```
 */
export async function scanLayerCollections(
  layer: OhneLayer,
  collections: string,
): Promise<ScannedCollection[]> {
  const entries = await listDir(joinPath(layer.dir, collections), { ext: 'ts', files: true });
  if (isNull(entries)) return [];

  const seen = new Map<string, string>();
  return entries
    .filter((entry) => !entry.relativePath.split('/').some((segment) => segment.startsWith('_')))
    .sort((a, b) => naturalCompare(a.relativePath, b.relativePath))
    .map((entry) => {
      assertImportablePath('collection', entry.relativePath, entry.path);
      validateCollectionName(entry.stem, entry.path);
      const clash = seen.get(entry.stem);
      if (!isUndefined(clash)) {
        throw ohneError({
          title: `Duplicate collection \`${entry.stem}\``,
          body: [
            `Two files in layer \`${layer.name}\` resolve to the same name.`,
            '',
            `- \`${relativePath(process.cwd(), clash)}\``,
            `- \`${relativePath(process.cwd(), entry.path)}\``,
          ],
        });
      }
      seen.set(entry.stem, entry.path);
      return { name: entry.stem, file: entry.path };
    });
}
