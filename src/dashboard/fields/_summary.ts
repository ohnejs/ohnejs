import type { Child } from '../render/insert.ts';
import type { DashboardField } from '../runtime/meta-types.ts';
import type { Translate } from '../runtime/use-t.ts';

import { isArray } from '../../utils/is/is-array.ts';
import { isBoolean } from '../../utils/is/is-boolean.ts';
import { isNumber } from '../../utils/is/is-number.ts';
import { isPlainObject } from '../../utils/is/is-plain-object.ts';
import { isString } from '../../utils/is/is-string.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { h } from '../render/h.ts';
import { summarizable } from './_search.ts';
import { dimMark } from './field-type.ts';
import { labelOf } from './labels.ts';

/**
 * A child item's one-line digest values, in field order.
 * Scalar columns contribute their text, `record` links their resolved label.
 * A nested child's own values flatten in place.
 * Booleans, list kinds, and unresolved links contribute nothing.
 */
export function summaryParts(
  item: Readonly<Record<string, unknown>>,
  subfields: readonly DashboardField[],
): string[] {
  const parts: string[] = [];
  for (const field of subfields) {
    if (!summarizable(field)) continue;
    const value = item[field.name];
    if (field.kind === 'column') {
      const text = scalarText(value);
      if (text !== '') parts.push(text);
    } else if (field.kind === 'record') {
      const label = linkLabel(field, value);
      if (label !== '') parts.push(label);
    } else if (field.kind === 'childOne' && isPlainObject<Record<string, unknown>>(value)) {
      parts.push(...summaryParts(value, field.subfields ?? []));
    }
  }
  return parts;
}

/**
 * A child item's tooltip: one `label: value` row per carried value.
 * Booleans read yes or no, list kinds their item count, and a nested child's labels chain with `›`.
 */
export function summaryTitle(
  item: Readonly<Record<string, unknown>>,
  subfields: readonly DashboardField[],
  t: Translate,
): string {
  return titleRows(item, subfields, t, '').join('\n');
}

/**
 * The digest parts as one truncating line, dim middle dots between them and `title` on the whole.
 */
export function summarySpan(parts: readonly string[], title: string): HTMLElement {
  const children: Child[] = [];
  for (const text of parts) {
    if (children.length > 0) children.push(dimMark(' · '));
    children.push(text);
  }
  return h('span', { class: 'ohne-truncate', title }, children);
}

function titleRows(
  item: Readonly<Record<string, unknown>>,
  subfields: readonly DashboardField[],
  t: Translate,
  prefix: string,
): string[] {
  const rows: string[] = [];
  for (const field of subfields) {
    if (!summarizable(field)) continue;
    const value = item[field.name];
    const label = prefix === '' ? field.label : `${prefix} › ${field.label}`;
    if (field.kind === 'column') {
      const text = isBoolean(value)
        ? value
          ? t('dashboard.yes')
          : t('dashboard.no')
        : scalarText(value);
      if (text !== '') rows.push(`${label}: ${text}`);
    } else if (field.kind === 'record') {
      const resolved = linkLabel(field, value);
      if (resolved !== '') rows.push(`${label}: ${resolved}`);
    } else if (field.kind === 'childOne') {
      if (isPlainObject<Record<string, unknown>>(value)) {
        rows.push(...titleRows(value, field.subfields ?? [], t, label));
      }
    } else if (isArray(value) && value.length > 0) {
      rows.push(`${label}: ${value.length} ×`);
    }
  }
  return rows;
}

/**
 * The link's resolved label, `''` while unresolved or absent.
 */
function linkLabel(field: DashboardField, value: unknown): string {
  if (!isString(value) || value === '') return '';
  const label = labelOf(field.target ?? '', value);
  return isUndefined(label) ? '' : label;
}

/**
 * The value as digest text: a string as it is, a number stringified, anything else `''`.
 */
function scalarText(value: unknown): string {
  if (isString(value)) return value;
  if (isNumber(value)) return String(value);
  return '';
}
