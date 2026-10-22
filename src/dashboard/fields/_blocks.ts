import type { IconName } from '../../utils/icon/icon-name.ts';
import type { DashboardBlock } from '../runtime/meta-types.ts';
import type { FieldForm } from './field-form.ts';

import { isEmpty } from '../../utils/is/is-empty.ts';
import { isString } from '../../utils/is/is-string.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { dashboardMeta } from '../runtime/meta.ts';
import { translateMessage } from '../runtime/use-t.ts';
import { summaryParts } from './_summary.ts';

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

/**
 * The name of one block instance: its block's label, then its title field's live text in parentheses.
 * The text is the field's digest, so a rich text or a link title names the instance too.
 * An undescribed block reads as its `name`, and an empty title leaves the bare label.
 */
export function blockTitle(
  block: DashboardBlock | undefined,
  name: string,
  form: FieldForm,
): string {
  const label = isUndefined(block) ? name : translateMessage(block.label);
  const field = block?.fields.find((entry) => entry.name === block.titleField);
  if (isUndefined(field)) return label;
  const value = form.controlOf(field.name)?.read().value;
  const text = summaryParts({ [field.name]: value }, [field]).join(' ');
  return isEmpty(text) ? label : `${label} (${text})`;
}
