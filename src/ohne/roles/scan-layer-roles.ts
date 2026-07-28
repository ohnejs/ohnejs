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
 * One role file found in a layer, before its definition is imported.
 */
export interface ScannedRole {
  /**
   * The role name, derived from the file's relative path via `pathToKebabName`.
   */
  name: string;

  /**
   * Absolute path of the file that default-exports the definition.
   */
  file: string;
}

/**
 * Reads every role file in one layer's roles directory.
 *
 * Each `.ts` file under `<layer.dir>/<roles>` is one role, named via `pathToKebabName`.
 * A `_`-prefixed file or directory is a helper and is skipped.
 * Two files resolving to the same name collide and throw, naming both.
 * Results sort by file path; returns `[]` when the layer has no roles directory.
 *
 * @example
 * ```ts
 * await scanLayerRoles({ name: 'app', dir: '/app' }, 'roles')
 * // -> [{ name: 'editor', file: '/app/roles/editor.ts' }]
 * ```
 */
export async function scanLayerRoles(layer: OhneLayer, roles: string): Promise<ScannedRole[]> {
  const entries = await listDir(joinPath(layer.dir, roles), { ext: 'ts', files: true });
  if (isNull(entries)) return [];

  const seen = new Map<string, string>();
  return entries
    .filter((entry) => !entry.relativePath.split('/').some((segment) => segment.startsWith('_')))
    .sort((a, b) => naturalCompare(a.relativePath, b.relativePath))
    .map((entry) => {
      assertImportablePath('role', entry.relativePath, entry.path);
      const name = pathToKebabName(entry.relativePath);
      const clash = seen.get(name);
      if (!isUndefined(clash)) {
        throw ohneError({
          title: `Duplicate role \`${name}\``,
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
