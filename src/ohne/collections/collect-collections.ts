import type { OhneLayer } from '../project/resolve-ohne-layers.ts';
import type { AnyCollectionDefinition } from './define-collection.ts';
import type { ScannedCollection } from './scan-layer-collections.ts';

import { importDefault } from '../../utils/fs/index.ts';
import { isPlainObject, naturalCompare, relativePath } from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';
import { DIR_DEFAULTS } from '../layers/config.ts';
import { useLayers } from '../layers/use-layers.ts';
import { scanLayerCollections } from './scan-layer-collections.ts';

/**
 * One collection with its imported definition, ready for codegen.
 */
export interface CollectedCollection extends ScannedCollection {
  /**
   * The definition the file default-exports.
   */
  collection: AnyCollectionDefinition;
}

/**
 * Options for `collectCollections`.
 */
export interface CollectCollectionsOptions {
  /**
   * Collection names to drop after the merge, matched exactly.
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
 * Combines the collections of every layer into one deduplicated, imported list.
 *
 * Each layer is scanned in its own `dirs.collections` (default `'collections'`).
 * A closer layer's collection replaces a further one's under the same name.
 * Names in `disable` are dropped after the merge.
 * Case-insensitively colliding names among the survivors throw, naming both files.
 * Each survivor's definition is imported; a missing or malformed default export throws.
 * Results sort by name for deterministic output.
 */
export async function collectCollections(
  layers: readonly OhneLayer[],
  options: CollectCollectionsOptions = {},
): Promise<CollectedCollection[]> {
  const { disable = [], fresh = false } = options;
  const configByPath = new Map(
    useLayers()
      .layers()
      .map((layer) => [layer.path, layer.input]),
  );
  const byName = new Map<string, ScannedCollection>();
  for (const layer of layers) {
    const dir = configByPath.get(layer.dir)?.dirs?.collections ?? DIR_DEFAULTS.collections;
    for (const scanned of await scanLayerCollections(layer, dir)) byName.set(scanned.name, scanned);
  }

  const dropped = new Set(disable);
  const survivors = [...byName.values()]
    .filter((scanned) => !dropped.has(scanned.name))
    .sort((a, b) => naturalCompare(a.name, b.name));
  assertDistinctNames(survivors);

  return Promise.all(
    survivors.map(async (scanned) => ({
      ...scanned,
      collection: await definitionOf(scanned, fresh),
    })),
  );
}

/**
 * Rejects two surviving collections whose names differ only by case.
 * SQLite matches identifiers case-insensitively even when quoted, so the two cannot coexist.
 */
function assertDistinctNames(scanned: readonly ScannedCollection[]): void {
  const seen = new Map<string, ScannedCollection>();
  for (const collection of scanned) {
    const first = seen.get(collection.name.toLowerCase());
    if (first) {
      throw ohneError({
        title: `Collection names \`${first.name}\` and \`${collection.name}\` collide`,
        body: [
          'Identifiers match case-insensitively, so these cannot coexist.',
          '',
          `- \`${relativePath(process.cwd(), first.file)}\``,
          `- \`${relativePath(process.cwd(), collection.file)}\``,
        ],
      });
    }
    seen.set(collection.name.toLowerCase(), collection);
  }
}

/**
 * Imports one collection's definition and rejects a file that does not default-export one.
 */
async function definitionOf(
  scanned: ScannedCollection,
  fresh: boolean,
): Promise<AnyCollectionDefinition> {
  const definition = await importDefault<AnyCollectionDefinition>(scanned.file, { fresh });
  if (!isPlainObject(definition) || !isPlainObject(definition.fields)) {
    throw ohneError({
      title: `Collection \`${scanned.name}\` has no definition`,
      body: ['Default-export a `defineCollection(...)` result from the file.'],
      path: scanned.file,
    });
  }
  return definition;
}
