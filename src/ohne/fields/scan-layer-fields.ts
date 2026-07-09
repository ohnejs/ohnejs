import type { OhneLayer } from '../project/resolve-ohne-layers.ts';

import { listDir } from '../../utils/fs/index.ts';
import { isNull, isUndefined, joinPath, naturalCompare, relativePath } from '../../utils/index.ts';
import { assertImportablePath } from '../codegen/assert-importable-path.ts';
import { ohneError } from '../error/ohne-error.ts';
import { validateFieldTypeName } from './validate-field.ts';

/**
 * One field-type file found in a layer, before its definition is imported.
 */
export interface ScannedFieldType {
  /**
   * The field-type name: the file's stem, camelCase.
   */
  name: string;

  /**
   * Absolute path of the file that default-exports the definition.
   */
  file: string;
}

/**
 * Reads every field-type file in one layer's fields directory.
 *
 * Each `.ts` file under `<layer.dir>/<fields>` is one field type named by its stem.
 * A subdirectory only organizes files; it never contributes to the name.
 * Two files sharing a stem therefore collide and throw, naming both.
 * A `_`-prefixed file or directory is a helper and is skipped, so shared types can live beside a type.
 * Names are validated as they are read, so a bad file name fails here, naming the file.
 * Results sort by file name; returns `[]` when the layer has no fields directory.
 *
 * @example
 * ```ts
 * await scanLayerFields({ name: 'app', dir: '/app' }, 'fields')
 * // -> [{ name: 'slug', file: '/app/fields/slug.ts' }]
 * ```
 */
export async function scanLayerFields(
  layer: OhneLayer,
  fields: string,
): Promise<ScannedFieldType[]> {
  const entries = await listDir(joinPath(layer.dir, fields), { ext: 'ts', files: true });
  if (isNull(entries)) return [];

  const seen = new Map<string, string>();
  return entries
    .filter((entry) => !entry.relativePath.split('/').some((segment) => segment.startsWith('_')))
    .sort((a, b) => naturalCompare(a.relativePath, b.relativePath))
    .map((entry) => {
      assertImportablePath('field type', entry.relativePath, entry.path);
      validateFieldTypeName(entry.stem, entry.path);
      const clash = seen.get(entry.stem);
      if (!isUndefined(clash)) {
        throw ohneError({
          title: `Duplicate field type \`${entry.stem}\``,
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
