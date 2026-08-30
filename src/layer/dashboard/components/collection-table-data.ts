import {
  api,
  type Child,
  type DashboardCollection,
  type DashboardField,
  dimMark,
  fieldTypeFor,
  h,
  joinLabel,
  seedLabel,
  useDashboardLanguage,
} from 'ohne/dashboard';
import { hasKey, isEmpty, isNumber, isString, isUndefined } from 'ohne/utils';

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
 * The `_updatedAt` renderings: time-only for today, short date otherwise, medium for the tooltip.
 */
type DateVariant = 'time' | 'short' | 'full';

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

const DATE_OPTIONS: Record<DateVariant, Intl.DateTimeFormatOptions> = {
  time: { timeStyle: 'short' },
  short: { dateStyle: 'short', timeStyle: 'short' },
  full: { dateStyle: 'medium', timeStyle: 'short' },
};

const dateFormats = new Map<string, Intl.DateTimeFormat>();

/**
 * The collection's readable fields, the candidates every table surface offers.
 */
export function readableFields(collection: DashboardCollection): DashboardField[] {
  return collection.fields.filter((field) => field.readable);
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
 */
export function displayFor(field: DashboardField, row: TableRecord): Child {
  if (field.name === '_updatedAt') {
    return () => {
      const value = row['_updatedAt'];
      if (!isNumber(value)) return dimMark('-');
      const language = useDashboardLanguage().value;
      const variant: DateVariant = isToday(value) ? 'time' : 'short';
      return h(
        'span',
        { class: 'ohne-truncate', title: dateFormat(language, 'full').format(value) },
        dateFormat(language, variant).format(value),
      );
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

/**
 * Whether the timestamp falls on the viewer's local today.
 */
function isToday(timestamp: number): boolean {
  const date = new Date(timestamp);
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

/**
 * The memoized `_updatedAt` formatter for `language` in `variant`.
 */
function dateFormat(language: string, variant: DateVariant): Intl.DateTimeFormat {
  const key = `${language} ${variant}`;
  let format = dateFormats.get(key);
  if (isUndefined(format)) {
    format = new Intl.DateTimeFormat(language, DATE_OPTIONS[variant]);
    dateFormats.set(key, format);
  }
  return format;
}
