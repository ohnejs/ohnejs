import type { OhneLayer } from '../project/resolve-ohne-layers.ts';
import type { AnyBlockDefinition } from './define-block.ts';
import type { ScannedBlock } from './scan-layer-blocks.ts';

import { importDefault } from '../../utils/fs/index.ts';
import { isPlainObject, naturalCompare, relativePath } from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';
import { DIR_DEFAULTS } from '../layers/config.ts';
import { useLayers } from '../layers/use-layers.ts';
import { scanLayerBlocks } from './scan-layer-blocks.ts';

/**
 * One block with its imported definition, ready for codegen.
 */
export interface CollectedBlock extends ScannedBlock {
  /**
   * The definition the file default-exports.
   */
  block: AnyBlockDefinition;
}

/**
 * Options for `collectBlocks`.
 */
export interface CollectBlocksOptions {
  /**
   * Block names to drop after the merge, matched exactly.
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
 * Combines the blocks of every layer into one deduplicated, imported list.
 *
 * Each layer is scanned in its own `dirs.blocks` (default `'blocks'`).
 * A closer layer's block replaces a further one's under the same name.
 * Names in `disable` are dropped after the merge.
 * Case-insensitively colliding names among the survivors throw, naming both files.
 * Each survivor's definition is imported; a missing or malformed default export throws.
 * Results sort by name for deterministic output.
 */
export async function collectBlocks(
  layers: readonly OhneLayer[],
  options: CollectBlocksOptions = {},
): Promise<CollectedBlock[]> {
  const { disable = [], fresh = false } = options;
  const configByPath = new Map(
    useLayers()
      .layers()
      .map((layer) => [layer.path, layer.input]),
  );
  const byName = new Map<string, ScannedBlock>();
  for (const layer of layers) {
    const dir = configByPath.get(layer.dir)?.dirs?.blocks ?? DIR_DEFAULTS.blocks;
    for (const scanned of await scanLayerBlocks(layer, dir)) byName.set(scanned.name, scanned);
  }

  const dropped = new Set(disable);
  const survivors = [...byName.values()]
    .filter((scanned) => !dropped.has(scanned.name))
    .sort((a, b) => naturalCompare(a.name, b.name));
  assertDistinctNames(survivors);

  return Promise.all(
    survivors.map(async (scanned) => ({
      ...scanned,
      block: await definitionOf(scanned, fresh),
    })),
  );
}

/**
 * Rejects two surviving blocks whose names differ only by case.
 * SQLite matches identifiers case-insensitively even when quoted, so the two cannot coexist.
 */
function assertDistinctNames(scanned: readonly ScannedBlock[]): void {
  const seen = new Map<string, ScannedBlock>();
  for (const block of scanned) {
    const first = seen.get(block.name.toLowerCase());
    if (first) {
      throw ohneError({
        title: `Block names \`${first.name}\` and \`${block.name}\` collide`,
        body: [
          'Identifiers match case-insensitively, so these cannot coexist.',
          '',
          `- \`${relativePath(process.cwd(), first.file)}\``,
          `- \`${relativePath(process.cwd(), block.file)}\``,
        ],
      });
    }
    seen.set(block.name.toLowerCase(), block);
  }
}

/**
 * Imports one block's definition and rejects a file that does not default-export one.
 */
async function definitionOf(scanned: ScannedBlock, fresh: boolean): Promise<AnyBlockDefinition> {
  const definition = await importDefault<AnyBlockDefinition>(scanned.file, { fresh });
  if (!isPlainObject(definition) || !isPlainObject(definition.fields)) {
    throw ohneError({
      title: `Block \`${scanned.name}\` has no definition`,
      body: ['Default-export a `defineBlock(...)` result from the file.'],
      path: scanned.file,
    });
  }
  return definition;
}
