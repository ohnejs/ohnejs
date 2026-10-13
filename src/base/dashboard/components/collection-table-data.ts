import {
  api,
  attachTooltip,
  type Child,
  type DashboardCollection,
  type DashboardField,
  dashboardMeta,
  dashboardMetaIdentity,
  dimMark,
  fieldTypeFor,
  formatDateTime,
  formatRelative,
  h,
  joinLabel,
  readAPIError,
  seedLabel,
  useDashboardLanguage,
} from 'ohnejs/dashboard';
import {
  hasKey,
  isEmpty,
  isNumber,
  isPlainObject,
  isString,
  isUndefined,
  onCleanup,
  shortUUID,
  untracked,
} from 'ohnejs/utils';

import { sortableFieldsOf, type TableURLState } from './collection-table-state.ts';
import { translationsCell } from './translations-cell.ts';

/**
 * One record row, as the collections API answers it.
 */
export type TableRecord = Record<string, unknown>;

/**
 * One page of records, as the body-query endpoint answers it.
 */
export interface QueryPage {
  /**
   * The records on this page, in the query's order.
   */
  records: TableRecord[];

  /**
   * The page read, one-based; it exceeds `lastPage` when the request asked past the end.
   */
  page: number;

  /**
   * The number of the last page, at least `1` even when nothing matches.
   */
  lastPage: number;

  /**
   * The page size the read used.
   */
  perPage: number;

  /**
   * The total number of matching records across every page.
   */
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

const views = new Map<string, string>();
const pickerViews = new Map<string, TableURLState>();
let basis = dashboardMetaIdentity();

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
 * The collection's readable fields a column header can sort by.
 */
export function sortableFields(collection: DashboardCollection): DashboardField[] {
  return sortableFieldsOf(collection.fields);
}

/**
 * Remembers `search` as the segment's last table view, in `location.search` form.
 * The list page owns these entries; the record picker only seeds its first view from them.
 */
export function rememberView(segment: string, search: string): void {
  sync();
  views.set(segment, search);
}

/**
 * The query string a bare visit to the collection's table restores, in `location.search` form.
 * The tab's remembered view wins, `''` included; else the user's default view; else `''`.
 * An empty default stays `''`, since a bare `?` would never match the location the browser reports.
 * The discovery data is read untracked, so a restore effect never reruns when it refreshes.
 */
export function rememberedView(collection: DashboardCollection): string {
  sync();
  const remembered = views.get(collection.segment);
  if (!isUndefined(remembered)) return remembered;
  const view = untracked(dashboardMeta)?.defaultViews[collection.name]?.view ?? '';
  return view === '' ? '' : `?${view}`;
}

/**
 * Remembers `state` as the record picker's view for the segment, reopened by its next picker.
 * The memory holds `state` itself, so pass a copy the caller never mutates.
 */
export function rememberPickerView(segment: string, state: TableURLState): void {
  sync();
  pickerViews.set(segment, state);
}

/**
 * The record picker's remembered view for the segment, `undefined` before any picker of it changed view.
 * Copy it before mutating, since the memory keeps this very object.
 */
export function rememberedPickerView(segment: string): TableURLState | undefined {
  sync();
  return pickerViews.get(segment);
}

/**
 * Loads one page through `POST /collections/[segment]/query`.
 * A `400` that names a wire error path resolves `{ refused }`, the path of the refused query part.
 * Any other failure resolves `undefined`.
 */
export async function loadTablePage(
  segment: string,
  body: Record<string, unknown>,
): Promise<QueryPage | { refused: string } | undefined> {
  try {
    const response = await api(`POST /collections/${segment}/query`, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.ok) return (await response.json()) as QueryPage;
    if (response.status !== 400) return undefined;
    const { data } = await readAPIError(response, '');
    return isPlainObject(data) && isString(data.path) ? { refused: data.path } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Loads one page through `POST /collections/[segment]/query`; a failure resolves `undefined`.
 */
export async function loadPage(
  segment: string,
  body: Record<string, unknown>,
): Promise<QueryPage | undefined> {
  const loaded = await loadTablePage(segment, body);
  return isUndefined(loaded) || 'refused' in loaded ? undefined : loaded;
}

/**
 * The message a table surface toasts once `healView` produced `patch`, naming the part it dropped.
 */
export function droppedMessage(
  patch: Partial<TableURLState>,
):
  | 'dashboard.table.filterDropped'
  | 'dashboard.table.sortDropped'
  | 'dashboard.table.columnsDropped' {
  if (hasKey(patch, 'where')) return 'dashboard.table.filterDropped';
  return hasKey(patch, 'order') ? 'dashboard.table.sortDropped' : 'dashboard.table.columnsDropped';
}

/**
 * Seeds the label cache from a page loaded at `locale`, so relation cells naming these rows resolve free.
 * A row missing a label part never seeds, so a page selecting only some parts cannot cache a partial join.
 */
export function seedLabels(
  collection: DashboardCollection,
  records: readonly TableRecord[],
  locale: string | undefined,
): void {
  const names = collection.labelFields;
  if (isEmpty(names)) return;
  for (const row of records) {
    const uuid = row.UUID;
    if (!isString(uuid) || !names.every((name) => hasKey(row, name))) continue;
    const label = joinLabel(row, collection);
    if (label !== '') seedLabel(collection.name, uuid, label, locale);
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
      return h('span', { class: 'cell-mono cell-dim', title: value }, shortUUID(value));
    };
  }
  return fieldTypeFor(field).display({
    field,
    value: () => row[field.name],
    language: () => useDashboardLanguage().value,
  });
}

/**
 * Forgets every remembered view once the identity they were made under is gone.
 * A view holds filter values, so the next user never lands on the last one's.
 * An in-place refresh of the discovery data keeps them, since the same user still owns them.
 */
function sync(): void {
  const current = dashboardMetaIdentity();
  if (current === basis) return;
  views.clear();
  pickerViews.clear();
  basis = current;
}
