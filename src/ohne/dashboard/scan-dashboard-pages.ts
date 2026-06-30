import type { OhneLayer } from '../project/resolve-ohne-layers.ts';

import { listDir } from '../../utils/fs/index.ts';
import {
  isNull,
  isUndefined,
  joinPath,
  naturalCompare,
  pathToRoutePattern,
  relativePath,
} from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';
import { DASHBOARD_PAGES_DIR, type DashboardPage } from './dashboard-page.ts';

/**
 * Reads every page file in one layer's dashboard pages directory.
 *
 * Each `.ts` file under `<layer.dir>/<dashboard>/pages` maps to a route via `pathToRoutePattern`.
 * Results are sorted by file path so the output is deterministic.
 * Returns `[]` when the layer has no pages directory.
 * Throws when two files in the layer resolve to the same pattern, since one would silently shadow the other.
 *
 * @example
 * ```ts
 * await scanDashboardPages({ name: 'app', dir: '/app' }, 'dashboard')
 * // -> [{ pattern: '/users/[id]', module: 'pages/users/[id].ts', file: '...', layer: 'app' }]
 * ```
 */
export async function scanDashboardPages(
  layer: OhneLayer,
  dashboard: string,
): Promise<DashboardPage[]> {
  const entries = await listDir(joinPath(layer.dir, dashboard, DASHBOARD_PAGES_DIR), {
    ext: 'ts',
    files: true,
  });
  if (isNull(entries)) return [];

  const seen = new Map<string, string>();
  return entries
    .sort((a, b) => naturalCompare(a.relativePath, b.relativePath))
    .map((entry) => {
      const pattern = pathToRoutePattern(entry.relativePath);
      const clash = seen.get(pattern);
      if (!isUndefined(clash)) {
        throw ohneError({
          title: `Duplicate page \`${pattern}\``,
          body: [
            `Two files in layer \`${layer.name}\` resolve to the same dashboard page.`,
            '',
            `- \`${relativePath(process.cwd(), clash)}\``,
            `- \`${relativePath(process.cwd(), entry.path)}\``,
          ],
        });
      }
      seen.set(pattern, entry.path);
      return {
        pattern,
        module: joinPath(DASHBOARD_PAGES_DIR, entry.relativePath),
        file: entry.path,
        layer: layer.name,
      };
    });
}
