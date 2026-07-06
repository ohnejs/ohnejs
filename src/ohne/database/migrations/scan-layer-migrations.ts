import type { OhneLayer } from '../../project/resolve-ohne-layers.ts';

import { listDir } from '../../../utils/fs/index.ts';
import { extname, isNull, joinPath, naturalCompare } from '../../../utils/index.ts';
import { assertImportablePath } from '../../codegen/assert-importable-path.ts';

/**
 * One migration file found in a layer, before its definition is imported.
 */
export interface ScannedMigration {
  /**
   * The identity the migration is stamped under: `<layer>/<filename>` without the extension.
   */
  name: string;

  /**
   * Absolute path of the file that default-exports the definition.
   */
  file: string;
}

/**
 * Reads every migration file in one layer's migrations directory.
 *
 * Each `.ts` file under `<layer.dir>/<migrations>` is one migration named `<layer>/<stem>`.
 * Results sort by file name, the order they run in within the layer.
 * Returns `[]` when the layer has no migrations directory.
 *
 * @example
 * ```ts
 * await scanLayerMigrations({ name: 'app', dir: '/app' }, 'migrations')
 * // -> [{ name: 'app/2026-07-06-draft', file: '/app/migrations/2026-07-06-draft.ts' }]
 * ```
 */
export async function scanLayerMigrations(
  layer: OhneLayer,
  migrations: string,
): Promise<ScannedMigration[]> {
  const entries = await listDir(joinPath(layer.dir, migrations), { ext: 'ts', files: true });
  if (isNull(entries)) return [];
  return entries
    .sort((a, b) => naturalCompare(a.relativePath, b.relativePath))
    .map((entry) => {
      assertImportablePath('migration', entry.relativePath, entry.path);
      const stem = entry.relativePath.slice(0, -extname(entry.relativePath).length);
      return { name: `${layer.name}/${stem}`, file: entry.path };
    });
}
