import { loadMessages } from './messages.ts';
import { invalidateDashboardMeta } from './meta.ts';
import { type DashboardLanguage, useDashboardLanguage } from './use-dashboard-language.ts';

let latest: DashboardLanguage | undefined;

/**
 * Switches the dashboard language once its message catalogs have loaded.
 * The page then rebuilds in the new language with every message ready, so no raw key flashes.
 * The discovery store refetches too, so its labels follow.
 * When switches overlap, the last one called wins, however their loads finish.
 *
 * @example
 * ```ts
 * h('button', { onClick: () => void setDashboardLanguage('de') }, 'Deutsch')
 * ```
 */
export async function setDashboardLanguage(next: DashboardLanguage): Promise<void> {
  latest = next;
  await loadMessages(next);
  if (latest !== next || useDashboardLanguage().value === next) return;
  writeDashboardLanguage(next);
  invalidateDashboardMeta();
}

/**
 * Writes the dashboard language at once, overriding any switch still loading its catalogs.
 * The caller loads the catalogs first, through `loadMessages`, so the page rebuilds with every message ready.
 */
export function writeDashboardLanguage(next: DashboardLanguage): void {
  latest = next;
  useDashboardLanguage().value = next;
}
