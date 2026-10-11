import type { Child } from '../render/insert.ts';
import type { DashboardPage, RouteContext } from './router.ts';

/**
 * How a dashboard page renders.
 */
export interface DashboardPageOptions {
  /**
   * Renders the page inside the registered page frame.
   * `false` renders it bare, as the sign-in and redirect-only pages do.
   *
   * @default
   * true
   */
  frame?: boolean;
}

/**
 * Defines a dashboard page.
 *
 * The component receives the `RouteContext` and returns a `Child`.
 * It runs once per visit; a navigation that changes only the query keeps it.
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
export function defineDashboardPage(
  page: (route: RouteContext) => Child,
  options?: DashboardPageOptions,
): DashboardPage {
  return Object.assign((route: RouteContext) => page(route), { frame: options?.frame ?? true });
}
