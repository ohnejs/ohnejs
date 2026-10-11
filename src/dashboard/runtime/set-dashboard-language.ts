import { loadLanguage } from './messages.ts';
import { type DashboardLanguage, requestedLanguage } from './use-dashboard-language.ts';

let latest: DashboardLanguage | undefined;

/**
 * Switches the dashboard language once its message catalogs have loaded.
 * Every live string then re-renders in place, with every message ready, so no raw key flashes.
 * The page keeps its state: a draft, the focus, a scroll position, an open popup.
 * A switch made while a navigation is pending lands together with the arriving page.
 * When switches overlap, the last one called wins, however their loads finish.
 *
 * @example
 * ```ts
 * h('button', { onClick: () => void setDashboardLanguage('de') }, 'Deutsch')
 * ```
 */
export async function setDashboardLanguage(next: DashboardLanguage): Promise<void> {
  latest = next;
  await loadLanguage(next);
  if (latest !== next || requestedLanguage().value === next) return;
  requestDashboardLanguage(next);
}

/**
 * Requests the dashboard language at once, overriding any switch still loading its catalogs.
 * The caller loads the catalogs first, through `loadLanguage`, so the text switches with every message ready.
 */
export function requestDashboardLanguage(next: DashboardLanguage): void {
  latest = next;
  requestedLanguage().value = next;
}
