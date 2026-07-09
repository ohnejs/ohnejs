import type { OhneLayer } from '../project/resolve-ohne-layers.ts';
import type { FieldType } from './define-field.ts';
import type { ScannedFieldType } from './scan-layer-fields.ts';

import { importDefault } from '../../utils/fs/index.ts';
import { isPlainObject, isString, naturalCompare } from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';
import { DIR_DEFAULTS } from '../layers/config.ts';
import { useLayers } from '../layers/use-layers.ts';
import { scanLayerFields } from './scan-layer-fields.ts';

/**
 * One field type with its imported definition, ready for codegen.
 */
export interface CollectedFieldType extends ScannedFieldType {
  /**
   * The definition the file default-exports.
   */
  fieldType: FieldType;
}

/**
 * Options for `collectFields`.
 */
export interface CollectFieldsOptions {
  /**
   * Field-type names to drop after the merge, matched exactly.
   *
   * @default
   * []
   */
  disable?: readonly string[];

  /**
   * Re-import each definition fresh, past the module cache.
   * The dev supervisor sets it to pick up edits in its own long-lived process.
   *
   * @default
   * false
   */
  fresh?: boolean;
}

/**
 * Combines the field types of every layer into one deduplicated, imported list.
 *
 * Each layer is scanned in its own `dirs.fields` (default `'fields'`).
 * A closer layer's field type replaces a further one's under the same name.
 * A name matching a built-in replaces the built-in at registration, closer-wins.
 * Names in `disable` are dropped after the merge.
 * Each survivor's definition is imported; a missing or malformed default export throws.
 * Results sort by name for deterministic output.
 */
export async function collectFields(
  layers: readonly OhneLayer[],
  options: CollectFieldsOptions = {},
): Promise<CollectedFieldType[]> {
  const { disable = [], fresh = false } = options;
  const configByPath = new Map(
    useLayers()
      .layers()
      .map((layer) => [layer.path, layer.input]),
  );
  const byName = new Map<string, ScannedFieldType>();
  for (const layer of layers) {
    const dir = configByPath.get(layer.dir)?.dirs?.fields ?? DIR_DEFAULTS.fields;
    for (const scanned of await scanLayerFields(layer, dir)) byName.set(scanned.name, scanned);
  }

  const dropped = new Set(disable);
  const survivors = [...byName.values()]
    .filter((scanned) => !dropped.has(scanned.name))
    .sort((a, b) => naturalCompare(a.name, b.name));

  return Promise.all(
    survivors.map(async (scanned) => ({
      ...scanned,
      fieldType: await definitionOf(scanned, fresh),
    })),
  );
}

/**
 * Imports one field type's definition and rejects a file that does not default-export one.
 */
async function definitionOf(scanned: ScannedFieldType, fresh: boolean): Promise<FieldType> {
  const definition = await importDefault<FieldType>(scanned.file, { fresh });
  if (
    !isPlainObject(definition) ||
    (definition.columnType !== false && !isString(definition.columnType))
  ) {
    throw ohneError({
      title: `Field type \`${scanned.name}\` has no definition`,
      body: ['Default-export a `defineField(...)` result from the file.'],
      path: scanned.file,
    });
  }
  return definition;
}
