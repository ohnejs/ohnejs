import type { OhneLayer } from '../project/resolve-ohne-layers.ts';

import { listDir } from '../../utils/fs/index.ts';
import {
  isNull,
  isUndefined,
  joinPath,
  naturalCompare,
  pathToPascalName,
  relativePath,
} from '../../utils/index.ts';
import { assertImportablePath } from '../codegen/assert-importable-path.ts';
import { validateCollectionName } from '../database/naming/validate-names.ts';
import { ohneError } from '../error/ohne-error.ts';

/**
 * One collection file found in a layer, before its definition is imported.
 */
export interface ScannedCollection {
  /**
   * The collection name, derived from the file's relative path: segments PascalCased and joined.
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
 * Each `.ts` file under `<layer.dir>/<collections>` is one collection named by its relative path.
 * The path's segments convert to PascalCase and join: `blog/Posts.ts` names `BlogPosts`.
 * So does `blog posts.ts` - a loose stem normalizes into the name instead of erroring.
 * A trailing `index` segment collapses into its parent: `blog/index.ts` names `Blog`.
 * Two files resolving to the same name collide and throw, naming both.
 * A `_`-prefixed file or directory is a helper and is skipped.
 * Names are validated as they are read, so an unnameable file fails here, naming the file.
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
      const name = pathToPascalName(entry.relativePath);
      validateCollectionName(name, entry.path);
      const clash = seen.get(name);
      if (!isUndefined(clash)) {
        throw ohneError({
          title: `Duplicate collection \`${name}\``,
          body: [
            `Two files in layer \`${layer.name}\` resolve to the same name.`,
            '',
            `- \`${relativePath(process.cwd(), clash)}\``,
            `- \`${relativePath(process.cwd(), entry.path)}\``,
          ],
        });
      }
      seen.set(name, entry.path);
      return { name, file: entry.path };
    });
}
