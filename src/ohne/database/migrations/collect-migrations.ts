import type { OhneLayer } from '../../project/resolve-ohne-layers.ts';
import type { ScannedMigration } from './scan-layer-migrations.ts';

import { DIR_DEFAULTS } from '../../layers/config.ts';
import { useLayers } from '../../layers/use-layers.ts';
import { scanLayerMigrations } from './scan-layer-migrations.ts';

/**
 * Combines the migrations of every layer into one execution-ordered list.
 *
 * Each layer is scanned in its own `dirs.migrations` (default `'migrations'`).
 * The value never comes from the cross-layer merge, so one layer cannot relocate another's migrations.
 * Order is the run order: furthest layer first, file name order within a layer.
 * Identities are layer-qualified, so layers never shadow one another.
 *
 * @example
 * ```ts
 * await collectMigrations([{ name: 'auth', dir: '/dep' }, { name: 'app', dir: '/app' }])
 * // -> [{ name: 'auth/001-keys', file: '/dep/migrations/001-keys.ts' }, ...]
 * ```
 */
export async function collectMigrations(layers: readonly OhneLayer[]): Promise<ScannedMigration[]> {
  const configByPath = new Map(
    useLayers()
      .layers()
      .map((layer) => [layer.path, layer.input]),
  );
  const collected: ScannedMigration[] = [];
  for (const layer of layers) {
    const dir = configByPath.get(layer.dir)?.dirs?.migrations ?? DIR_DEFAULTS.migrations;
    collected.push(...(await scanLayerMigrations(layer, dir)));
  }
  return collected;
}
