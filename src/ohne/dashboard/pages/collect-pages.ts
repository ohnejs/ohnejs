import type { OhneLayer } from '../../project/resolve-ohne-layers.ts';
import type { DashboardPage } from './page.ts';

import { naturalCompare } from '../../../utils/index.ts';
import { DIR_DEFAULTS } from '../../layers/config.ts';
import { useLayers } from '../../layers/use-layers.ts';
import { scanLayerDashboardPages } from './scan-layer-pages.ts';

/**
 * Combines the pages of every layer into one effective page table.
 *
 * Each layer is scanned in its own dashboard directory, from that layer's own `dirs.dashboard` (default `'dashboard'`).
 * Layers are scanned in order: when two produce the same pattern, the closer layer wins.
 * The table is sorted by pattern for stable output.
 *
 * @example
 * ```ts
 * await collectDashboardPages([{ name: 'auth', dir: '/dep' }, { name: 'app', dir: '/app' }])
 * ```
 */
export async function collectDashboardPages(
  layers: readonly OhneLayer[],
): Promise<DashboardPage[]> {
  const configByPath = new Map(
    useLayers()
      .layers()
      .map((layer) => [layer.path, layer.input]),
  );

  const table = new Map<string, DashboardPage>();
  for (const layer of layers) {
    const dir = configByPath.get(layer.dir)?.dirs?.dashboard ?? DIR_DEFAULTS.dashboard;
    for (const page of await scanLayerDashboardPages(layer, dir)) {
      table.set(page.pattern, page);
    }
  }

  return [...table.values()].sort((a, b) => naturalCompare(a.pattern, b.pattern));
}
