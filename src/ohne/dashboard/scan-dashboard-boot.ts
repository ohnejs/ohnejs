import type { OhneLayer } from '../project/resolve-ohne-layers.ts';

import { joinPath, relativePath } from '../../utils/index.ts';
import { scanLayerBoot } from '../boot/scan-layer-boot.ts';
import { assertImportablePath } from '../codegen/assert-importable-path.ts';
import { DASHBOARD_BOOT_DIR, type DiscoveredDashboardBoot } from './dashboard-boot.ts';

/**
 * Lists the dashboard boot files of one layer, in run order.
 *
 * Reads `<layer.dir>/<dashboard>/boot` by the rules of `scanLayerBoot`.
 * Only top-level `.ts` files count, name-sorted, and a `_`-prefixed file is a helper that is skipped.
 * An `index.ts` at the top is the only file returned, so a layer orders its own boot by importing there.
 * Returns `[]` when the layer has no dashboard boot directory.
 *
 * @example
 * ```ts
 * await scanDashboardBoot({ name: 'app', dir: '/app' }, 'dashboard')
 * // -> [{ module: 'boot/fields.ts', file: '/app/dashboard/boot/fields.ts', layer: 'app' }]
 * ```
 */
export async function scanDashboardBoot(
  layer: OhneLayer,
  dashboard: string,
): Promise<DiscoveredDashboardBoot[]> {
  const dir = joinPath(layer.dir, dashboard);
  return (await scanLayerBoot(dir, DASHBOARD_BOOT_DIR)).map((file) => {
    const module = relativePath(dir, file);
    assertImportablePath('boot file', module, file);
    return { module, file, layer: layer.name };
  });
}
