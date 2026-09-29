import type { OhneLayer } from '../project/resolve-ohne-layers.ts';
import type { ScannedFile } from './scan-layer-files.ts';

import { importDefault } from '../../utils/fs/index.ts';
import { capitalize, naturalCompare } from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';
import { DIR_DEFAULTS } from './config.ts';
import { scanLayerFiles } from './scan-layer-files.ts';
import { useLayers } from './use-layers.ts';

/**
 * A definition kind read from its own directory, named by its plural: `role` reads `dirs.roles`.
 */
export type LayerFileKind = 'role' | 'skill' | 'flow';

/**
 * One definition file with its imported default export under the kind's key.
 */
export type CollectedFile<K extends LayerFileKind, T> = ScannedFile & { [P in K]: T };

/**
 * Options for `collectLayerFiles` and the collectors built on it.
 */
export interface CollectLayerFilesOptions {
  /**
   * Names to drop after the merge, matched exactly.
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
 * Combines the definitions of one kind across every layer into one deduplicated, imported list.
 *
 * Each layer is scanned in its own `dirs` entry for the kind, falling back to `DIR_DEFAULTS`.
 * A closer layer's definition replaces a further one's under the same name.
 * Names in `disable` are dropped after the merge.
 * Each survivor's default export is imported and must pass `accepts`, or the file throws.
 * Results sort by name for deterministic output.
 */
export async function collectLayerFiles<K extends LayerFileKind, T>(
  kind: K,
  layers: readonly OhneLayer[],
  accepts: (definition: unknown) => definition is T,
  options: CollectLayerFilesOptions = {},
): Promise<CollectedFile<K, T>[]> {
  const { disable = [], fresh = false } = options;
  const key = `${kind}s` as const;
  const configByPath = new Map(
    useLayers()
      .layers()
      .map((layer) => [layer.path, layer.input]),
  );
  const byName = new Map<string, ScannedFile>();
  for (const layer of layers) {
    const dir = configByPath.get(layer.dir)?.dirs?.[key] ?? DIR_DEFAULTS[key];
    for (const scanned of await scanLayerFiles(kind, layer, dir)) {
      byName.set(scanned.name, scanned);
    }
  }

  const dropped = new Set(disable);
  const survivors = [...byName.values()]
    .filter((scanned) => !dropped.has(scanned.name))
    .sort((a, b) => naturalCompare(a.name, b.name));

  return Promise.all(
    survivors.map(async (scanned) => {
      const definition = await importDefault<unknown>(scanned.file, { fresh });
      if (!accepts(definition)) {
        throw ohneError({
          title: `${capitalize(kind)} \`${scanned.name}\` has no definition`,
          body: [`Default-export a \`define${capitalize(kind)}(...)\` result from the file.`],
          path: scanned.file,
        });
      }
      return { ...scanned, [kind]: definition } as CollectedFile<K, T>;
    }),
  );
}
