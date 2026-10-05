import type { IconName } from '../../utils/icon/icon-name.ts';
import type { DashboardBlock } from '../runtime/meta-types.ts';

import { isString } from '../../utils/is/is-string.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { dashboardMeta } from '../runtime/meta.ts';

/**
 * Every block type the discovery read describes, empty until it answers.
 * Block types are global, so one registry serves every `blocks` field at every depth.
 */
export function blocksOf(): readonly DashboardBlock[] {
  return dashboardMeta()?.blocks ?? [];
}

/**
 * The icon a block instance shows: the declared one, or the one its `field` value picks.
 * Without `fields`, a mapped icon falls back to its `default`, as for the block type itself.
 */
export function blockIcon(
  block: DashboardBlock | undefined,
  fields?: Readonly<Record<string, unknown>>,
): IconName {
  const icon = block?.icon;
  if (isUndefined(icon)) return 'cube';
  if (isString(icon)) return icon;
  const value = fields?.[icon.field];
  return (isUndefined(value) ? undefined : icon.map[String(value)]) ?? icon.default ?? 'cube';
}
