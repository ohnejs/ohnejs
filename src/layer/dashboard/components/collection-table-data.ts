import {
  api,
  attachTooltip,
  type Child,
  type DashboardCollection,
  type DashboardField,
  dashboardMeta,
  dimMark,
  fieldTypeFor,
  formatDateTime,
  formatRelative,
  h,
  joinLabel,
  seedLabel,
  useDashboardLanguage,
} from 'ohne/dashboard';
import { hasKey, isEmpty, isNumber, isString, onCleanup, untracked } from 'ohne/utils';

import { translationsCell } from './translations-cell.ts';

/**
 * One record row, as the collections API answers it.
 */
export type TableRecord = Record<string, unknown>;

/**
 * One page of records, as the body-query endpoint answers it.
 */
export interface QueryPage {
  records: TableRecord[];
  page: number;
  lastPage: number;
  perPage: number;
  total: number;
}

/**
 * The fixed page size every collection table surface reads with.
 */
export const PER_PAGE = 50;

/**
 * The order a collection table sorts by when the state declares none.
 */
export const DEFAULT_ORDER: readonly string[] = ['-_updatedAt'];

/**
 * The last table query string per collection segment, restored when the collection is revisited bare.
 * The list page owns the entries; the record picker only seeds its first view from them.
 */
export const tableMemory = new Map<string, string>();

/**
 * The fields a table surface resolves its columns from.
 * `_translations` stays out while one locale is configured: nothing translates, so the column says nothing.
 * The discovery data is read untracked, so a constructor may call this.
 */
export function columnFields(collection: DashboardCollection): DashboardField[] {
  const translates = collection.translatable && (untracked(dashboardMeta)?.locales.length ?? 0) > 1;
  return translates
    ? collection.fields
    : collection.fields.filter((field) => field.name !== '_translations');
}

/**
 * The collection's readable column fields, the candidates every table surface offers.
 */
export function readableFields(collection: DashboardCollection): DashboardField[] {
  return columnFields(collection).filter((field) => field.readable);
}

/**
 * The collection's sortable fields.
 * A json column holds a list, which has no order to sort by.
 */
export function sortableFields(collection: DashboardCollection): DashboardField[] {
  return collection.fields.filter(
    (field) => field.readable && field.kind === 'column' && field.logicalType !== 'json',
  );
}

/**
 * Loads one page through `POST /collections/[segment]/query`; a failure resolves `undefined`.
 */
export async function loadPage(
  segment: string,
  body: Record<string, unknown>,
): Promise<QueryPage | undefined> {
  try {
    const response = await api(`POST /collections/${segment}/query`, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) return undefined;
    return (await response.json()) as QueryPage;
  } catch {
    return undefined;
  }
}

/**
 * Seeds the label cache from a loaded page, so relation cells naming these rows resolve free.
 * A row missing a label part never seeds, so a page selecting only some parts cannot cache a partial join.
 */
export function seedLabels(collection: DashboardCollection, records: readonly TableRecord[]): void {
  const names = collection.labelFields;
  if (isEmpty(names)) return;
  for (const row of records) {
    const uuid = row.UUID;
    if (!isString(uuid) || !names.every((name) => hasKey(row, name))) continue;
    const label = joinLabel(row, collection);
    if (label !== '') seedLabel(collection.name, uuid, label);
  }
}

/**
 * The cell's display content: system fields render specially, the rest through their field type.
 * The `_translations` matrix renders static here; the collection table links its chips itself.
 * `_updatedAt` reads relative to now, ticking, with the instant in the user's formats as its tooltip.
 */
export function displayFor(field: DashboardField, row: TableRecord): Child {
  if (field.name === '_translations') return translationsCell(row, { canUpdate: false });
  if (field.name === '_updatedAt') {
    return () => {
      const value = row['_updatedAt'];
      if (!isNumber(value)) return dimMark('-');
      // A function child, so a clock tick patches the text alone and never rebuilds the element mid-hover.
      const element = h('span', { class: 'ohne-truncate' }, () => formatRelative(value));
      onCleanup(attachTooltip(element, () => formatDateTime(value)));
      return element;
    };
  }
  if (field.name === 'UUID') {
    return () => {
      const value = row['UUID'];
      if (!isString(value)) return dimMark('-');
      return h('span', { class: 'cell-mono cell-dim', title: value }, value.slice(0, 8));
    };
  }
  return fieldTypeFor(field).display({
    field,
    value: () => row[field.name],
    language: () => useDashboardLanguage().value,
  });
}
