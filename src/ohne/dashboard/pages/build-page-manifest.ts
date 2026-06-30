import type { DashboardPage } from './page.ts';

import { compareSpecificity, type PageRoute } from '../../../utils/index.ts';

/**
 * Shapes collected dashboard pages into the wire manifest the browser router consumes.
 *
 * Each page becomes a `PageRoute` whose `url` is `base` joined with the page module.
 * The manifest is ordered most-specific-first, so the client router resolves it with first-match-wins.
 *
 * @example
 * ```ts
 * buildDashboardManifest(
 *   [{ pattern: '/users/[id]', module: 'pages/users/[id].ts', file: '...', layer: 'app' }],
 *   '/m/app',
 * )
 * // -> [{ pattern: '/users/[id]', url: '/m/app/pages/users/[id].ts' }]
 * ```
 */
export function buildDashboardManifest(pages: readonly DashboardPage[], base: string): PageRoute[] {
  return pages
    .map((page) => ({ pattern: page.pattern, url: `${base}/${page.module}` }))
    .sort((a, b) => compareSpecificity(a.pattern, b.pattern));
}
