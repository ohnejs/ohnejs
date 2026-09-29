import type { OhneLayer } from '../project/resolve-ohne-layers.ts';

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

/**
 * One definition file found in a layer, before its default export is imported.
 */
export interface ScannedFile {
  /**
   * The definition's name, derived from the file's relative path via `pathToKebabName`.
   */
  name: string;

  /**
   * Absolute path of the file that default-exports the definition.
   */
  file: string;
}

/**
 * Reads every definition file of one kind in one layer directory.
 *
 * Each `.ts` file under `<layer.dir>/<dir>` is one definition, named via `pathToKebabName`.
 * A `_`-prefixed file or directory is a helper and is skipped.
 * Two files resolving to the same name collide and throw, naming the kind and both files.
 * Results sort by file path; returns `[]` when the layer has no such directory.
 *
 * @example
 * ```ts
 * await scanLayerFiles('role', { name: 'app', dir: '/app' }, 'roles')
 * // -> [{ name: 'editor', file: '/app/roles/editor.ts' }]
 * ```
 */
export async function scanLayerFiles(
  kind: string,
  layer: OhneLayer,
  dir: string,
): Promise<ScannedFile[]> {
  const entries = await listDir(joinPath(layer.dir, dir), { ext: 'ts', files: true });
  if (isNull(entries)) return [];

  const seen = new Map<string, string>();
  return entries
    .filter((entry) => !entry.relativePath.split('/').some((segment) => segment.startsWith('_')))
    .sort((a, b) => naturalCompare(a.relativePath, b.relativePath))
    .map((entry) => {
      assertImportablePath(kind, entry.relativePath, entry.path);
      const name = pathToKebabName(entry.relativePath);
      const clash = seen.get(name);
      if (!isUndefined(clash)) {
        throw ohneError({
          title: `Duplicate ${kind} \`${name}\``,
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
