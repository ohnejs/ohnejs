import type { OhneLayer } from '../project/resolve-ohne-layers.ts';
import type { MessageMeta } from './messages.ts';

import { naturalCompare } from '../../utils/index.ts';
import { DIR_DEFAULTS } from '../layers/config.ts';
import { useLayers } from '../layers/use-layers.ts';
import { scanLayerMessages } from './scan-layer-messages.ts';

/**
 * Combines the messages of every layer into one ordered list.
 *
 * Each layer is scanned in its own `dirs.messages` directory (default `'messages'`).
 * The value never comes from the cross-layer merge, so one layer cannot relocate another's messages.
 *
 * Layers are scanned in order: when two define the same key for one language, the closer layer wins.
 * Merging is per key, never per file, so a closer layer overrides one key and leaves the rest in place.
 * The result is sorted by language, then key, for deterministic output.
 *
 * @example
 * ```ts
 * await collectMessages([
 *   { name: 'base', dir: '/base' },
 *   { name: 'app', dir: '/app' },
 * ])
 * // -> [
 * //      {
 * //        key: 'field.required',
 * //        language: 'en',
 * //        template: '...',
 * //        layer: 'app',
 * //      }
 * //    ]
 * ```
 */
export async function collectMessages(layers: readonly OhneLayer[]): Promise<MessageMeta[]> {
  const configByPath = new Map(
    useLayers()
      .layers()
      .map((layer) => [layer.path, layer.input]),
  );

  const table = new Map<string, MessageMeta>();
  for (const layer of layers) {
    const dir = configByPath.get(layer.dir)?.dirs?.messages ?? DIR_DEFAULTS.messages;
    for (const message of await scanLayerMessages(layer, dir)) {
      table.set(`${message.language}\t${message.key}`, message);
    }
  }

  return [...table.values()].sort(
    (a, b) => naturalCompare(a.language, b.language) || naturalCompare(a.key, b.key),
  );
}
