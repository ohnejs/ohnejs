import type { OhneLayer } from '../project/resolve-ohne-layers.ts';
import type { MiddlewareMeta } from './middleware.ts';

import { naturalCompare, relativePath } from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';
import { DIR_DEFAULTS } from '../layers/config.ts';
import { useLayers } from '../layers/use-layers.ts';
import { scanLayerMiddleware } from './scan-layer-middleware.ts';

/**
 * Combines the middleware of every layer into one ordered list.
 *
 * Each layer is scanned in its own `dirs.middleware` directory (default `'middleware'`).
 * The value never comes from the cross-layer merge, so one layer cannot relocate another's middleware.
 *
 * Layers are scanned in order: when two resolve the same name, the closer layer wins.
 * The two must share a tier: a name that is global in one layer and named in another throws.
 * Global middleware come first, then named, each group sorted by name.
 * The global order is also their run order.
 * The named order is only a stable listing, since each route picks its own run order.
 *
 * @example
 * ```ts
 * await collectMiddleware([
 *   { name: 'base', dir: '/base' },
 *   { name: 'app', dir: '/app' },
 * ])
 * // -> [
 * //      { name: 'global-auth', isGlobal: true, ... },
 * //      { name: '20-locale', isGlobal: false, ... },
 * //    ]
 * ```
 */
export async function collectMiddleware(layers: readonly OhneLayer[]): Promise<MiddlewareMeta[]> {
  const configByPath = new Map(
    useLayers()
      .layers()
      .map((layer) => [layer.path, layer.input]),
  );

  const table = new Map<string, MiddlewareMeta>();
  for (const layer of layers) {
    const dir = configByPath.get(layer.dir)?.dirs?.middleware ?? DIR_DEFAULTS.middleware;
    for (const middleware of await scanLayerMiddleware(layer, dir)) {
      const existing = table.get(middleware.name);
      if (existing && existing.isGlobal !== middleware.isGlobal) {
        throw ohneError({
          title: `Middleware \`${middleware.name}\` is global in one layer, named in another`,
          body: [
            `\`${middleware.name}\` resolves to a global middleware in one layer and an opt-in one in another.`,
            `Put both files under \`global/\`, or neither, so the name has a single tier.`,
            '',
            `- \`${relativePath(process.cwd(), existing.file)}\` (${existing.isGlobal ? 'global' : 'named'})`,
            `- \`${relativePath(process.cwd(), middleware.file)}\` (${middleware.isGlobal ? 'global' : 'named'})`,
          ],
        });
      }
      table.set(middleware.name, middleware);
    }
  }

  const byName = (a: MiddlewareMeta, b: MiddlewareMeta) => naturalCompare(a.name, b.name);
  const entries = [...table.values()];
  return [
    ...entries.filter((entry) => entry.isGlobal).sort(byName),
    ...entries.filter((entry) => !entry.isGlobal).sort(byName),
  ];
}
