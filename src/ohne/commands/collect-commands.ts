import type { OhneLayer } from '../project/resolve-ohne-layers.ts';
import type { ScannedCommand } from './scan-layer-commands.ts';

import { naturalCompare } from '../../utils/index.ts';
import { DIR_DEFAULTS } from '../layers/config.ts';
import { useLayers } from '../layers/use-layers.ts';
import { scanLayerCommands } from './scan-layer-commands.ts';

/**
 * Combines the commands of every layer into one deduplicated list, importing none of them.
 *
 * Each layer is scanned in its own `dirs.commands` (default `'commands'`).
 * A closer layer's command replaces a further one's under the same name.
 * Results sort by name.
 *
 * @example
 * ```ts
 * await collectCommands([
 *   { name: 'ohnejs/uploads', dir: '/lib/uploads' },
 *   { name: 'app', dir: '/app' },
 * ])
 * // -> [
 * //      { name: 'seed', file: '/app/commands/seed.ts' },
 * //      { name: 'uploads', file: '/lib/uploads/commands/uploads.ts' },
 * //    ]
 * ```
 */
export async function collectCommands(layers: readonly OhneLayer[]): Promise<ScannedCommand[]> {
  const configByPath = new Map(
    useLayers()
      .layers()
      .map((layer) => [layer.path, layer.input]),
  );
  const byName = new Map<string, ScannedCommand>();
  for (const layer of layers) {
    const dir = configByPath.get(layer.dir)?.dirs?.commands ?? DIR_DEFAULTS.commands;
    for (const scanned of await scanLayerCommands(layer, dir)) byName.set(scanned.name, scanned);
  }
  return [...byName.values()].sort((a, b) => naturalCompare(a.name, b.name));
}
