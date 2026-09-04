import type { OhneLayer } from '../project/resolve-ohne-layers.ts';
import type { DiscoveredDashboardBoot } from './dashboard-boot.ts';

import { DIR_DEFAULTS } from '../layers/config.ts';
import { useLayers } from '../layers/use-layers.ts';
import { scanDashboardBoot } from './scan-dashboard-boot.ts';

/**
 * Combines the dashboard boot files of every layer into one run list, furthest layer first.
 *
 * Each layer is scanned in its own dashboard directory, from that layer's own `dirs.dashboard`.
 * That directory defaults to `'dashboard'`.
 * A file's identity is its path under that directory, and the served `/m/app/` root is merged closest-first.
 * So when two layers hold the same path, the closer layer's file is the one served and it runs once.
 * It keeps the slot of the furthest file at that path, so a replaced file never moves in the order.
 *
 * @example
 * ```ts
 * await collectDashboardBoot([
 *   { name: 'auth', dir: '/dep' },
 *   { name: 'app', dir: '/app' },
 * ])
 * // -> [
 * //      { module: 'boot/fields.ts', file: '/app/dashboard/boot/fields.ts', layer: 'app' },
 * //      { module: 'boot/slots.ts', file: '/dep/dashboard/boot/slots.ts', layer: 'auth' },
 * //    ]
 * ```
 */
export async function collectDashboardBoot(
  layers: readonly OhneLayer[],
): Promise<DiscoveredDashboardBoot[]> {
  const configByPath = new Map(
    useLayers()
      .layers()
      .map((layer) => [layer.path, layer.input]),
  );

  const table = new Map<string, DiscoveredDashboardBoot>();
  for (const layer of layers) {
    const dir = configByPath.get(layer.dir)?.dirs?.dashboard ?? DIR_DEFAULTS.dashboard;
    for (const boot of await scanDashboardBoot(layer, dir)) {
      table.set(boot.module, boot);
    }
  }

  return [...table.values()];
}
