import type { DashboardPage } from './router.ts';

/**
 * Defines a dashboard page.
 *
 * The component receives the `RouteContext` and returns a `Child`.
 * At runtime this returns it unchanged.
 * Export the result as the file's default export so dashboard page discovery can pick it up.
 *
 * @example
 * ```ts
 * // dashboard/pages/authors/[id].ts
 * import { defineDashboardPage, h } from 'ohnejs/dashboard'
 *
 * export default defineDashboardPage((route) => h('h1', null, route.params.id))
 * ```
 */
export function defineDashboardPage(page: DashboardPage): DashboardPage {
  return page;
}
