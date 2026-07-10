import type { OhneLayer } from '../project/resolve-ohne-layers.ts';

import { listDir } from '../../utils/fs/index.ts';
import {
  isNull,
  isUndefined,
  joinPath,
  naturalCompare,
  pathToCamelName,
  relativePath,
} from '../../utils/index.ts';
import { assertImportablePath } from '../codegen/assert-importable-path.ts';
import { ohneError } from '../error/ohne-error.ts';
import { validateFieldTypeName } from './validate-field.ts';

/**
 * One field-type file found in a layer, before its definition is imported.
 */
export interface ScannedFieldType {
  /**
   * The field-type name, derived from the file's relative path: segments camelCased and joined.
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
 * Each `.ts` file under `<layer.dir>/<fields>` is one field type named by its relative path.
 * The path's segments convert to camelCase and join: `geo/point.ts` names `geoPoint`.
 * So does `geo point.ts` - a loose stem normalizes into the name instead of erroring.
 * A trailing `index` segment collapses into its parent: `slug/index.ts` names `slug`.
 * Two files resolving to the same name collide and throw, naming both.
 * A `_`-prefixed file or directory is a helper and is skipped, so shared types can live beside a type.
 * Names are validated as they are read, so an unnameable file fails here, naming the file.
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
      const name = pathToCamelName(entry.relativePath);
      validateFieldTypeName(name, entry.path);
      const clash = seen.get(name);
      if (!isUndefined(clash)) {
        throw ohneError({
          title: `Duplicate field type \`${name}\``,
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
