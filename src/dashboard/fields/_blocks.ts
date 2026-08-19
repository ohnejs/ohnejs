import type { DashboardBlock } from '../runtime/meta-types.ts';

import { dashboardMeta } from '../runtime/meta.ts';

/**
 * Every block type the discovery read describes, empty until it answers.
 * Block types are global, so one registry serves every `blocks` field at every depth.
 */
export function blocksOf(): readonly DashboardBlock[] {
  return dashboardMeta()?.blocks ?? [];
}
