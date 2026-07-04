import type { DiscoveredDashboardPage } from './dashboard-page.ts';

import { compareSpecificity, type PageRoute } from '../../utils/index.ts';

/**
 * Shapes collected dashboard pages into the wire manifest the browser router consumes.
 *
 * Each page becomes a `PageRoute` whose `url` is `base` joined with the page module.
 * The manifest is ordered most-specific-first, so the client router resolves it with first-match-wins.
 *
 * @example
 * ```ts
 * buildDashboardPageManifest(
 *   [{ pattern: '/authors/[id]', module: 'pages/authors/[id].ts', file: '...', layer: 'app' }],
 *   '/m/app',
 * )
 * // -> [{ pattern: '/authors/[id]', url: '/m/app/pages/authors/[id].ts' }]
 * ```
 */
export function buildDashboardPageManifest(
  pages: readonly DiscoveredDashboardPage[],
  base: string,
): PageRoute[] {
  return pages
    .map((page) => ({ pattern: page.pattern, url: `${base}/${page.module}` }))
    .sort((a, b) => compareSpecificity(a.pattern, b.pattern));
}
