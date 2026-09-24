import { loadPage } from 'app/components/collection-table-data.ts';
import { parseTableState, serializeTableState } from 'app/components/collection-table-state.ts';
import { activeContentLocale } from 'app/components/content-language-switcher.ts';
import {
  api,
  type APIRouteID,
  type DashboardCollection,
  dashboardConfig,
  dashboardMeta,
  dispatchTrigger,
  openDialog,
  toast,
} from 'ohnejs/dashboard';
import {
  type ConditionObject,
  hasCapability,
  isEmpty,
  isUndefined,
  parseSearchParams,
  stringifySearchParams,
  uniqueArray,
  untracked,
} from 'ohnejs/utils';

import type { UploadRecord } from '../../uploads/types.ts';

import { useUploadsT } from './_messages.ts';
import { readWireError, type WireError } from './_wire-error.ts';
import { versionedURL } from './media-details-state.ts';
import {
  DEFAULT_ORDER,
  folderPresence,
  type FolderPresence,
  folderWhere,
  MEDIA_REFRESH,
  type MediaQuery,
  movePlan,
  PER_PAGE,
  pruneDescendants,
  scopedWhere,
} from './media-library-state.ts';

/**
 * One page of `Uploads` records, as the body-query endpoint answers it.
 */
export interface UploadsPage {
  /**
   * The decorated records of the page, in read order.
   */
  records: UploadRecord[];

  /**
   * The one-based page the records belong to.
   */
  page: number;

  /**
   * The last page number.
   */
  lastPage: number;

  /**
   * The page size the read used.
   */
  perPage: number;

  /**
   * The number of matching rows across every page.
   */
  total: number;
}

/**
 * What the signed-in viewer may do with uploads, read off the capabilities the discovery read lists.
 * The write routes sit under `/uploads` behind `collection.Uploads.*`, outside the collections API.
 * So the collection's operations cannot say; the viewer's capabilities do.
 */
export interface UploadsPermissions {
  /**
   * Whether the viewer may upload files and create folders.
   */
  canCreate: boolean;

  /**
   * Whether the viewer may rename, move, and edit uploads.
   */
  canUpdate: boolean;

  /**
   * Whether the viewer may delete uploads.
   */
  canDelete: boolean;
}

/**
 * The name of the collection the media library reads.
 */
export const UPLOADS_COLLECTION = 'Uploads';

/**
 * How many requests of a bulk action run at once.
 */
export const BATCH_LIMIT = 5;

/**
 * The last query string per folder, restored when the folder is revisited bare.
 */
export const mediaMemory = new Map<string, string>();

let deleting = false;

/**
 * The `Uploads` collection as the discovery read describes it, `undefined` while it loads or is unreadable.
 * Read untracked, so a constructor may call it.
 */
export function uploadsCollection(): DashboardCollection | undefined {
  return untracked(dashboardMeta)?.collections.find(
    (collection) => collection.name === UPLOADS_COLLECTION,
  );
}

/**
 * The viewer's upload permissions; every one `false` while the discovery read is pending.
 * Read untracked, so a constructor may call it.
 */
export function uploadsPermissions(): UploadsPermissions {
  const held = untracked(dashboardMeta)?.capabilities ?? [];
  const can = (operation: string): boolean =>
    hasCapability(held, `collection.${UPLOADS_COLLECTION}.${operation}`);
  return { canCreate: can('create'), canUpdate: can('update'), canDelete: can('delete') };
}

/**
 * Reads the media query out of a query string, exactly as the collection table reads its state.
 * A missing or invalid `page` reads as `1`, a missing `order` as the default, a non-object `where` as none.
 */
export function parseMediaQuery(search: string): MediaQuery {
  const { page, order, where } = parseTableState(search, DEFAULT_ORDER);
  return { page, order, where };
}

/**
 * Writes the media query into a query string without the leading `?`; defaults are omitted.
 * Params this module does not own, like `details`, carry over from `search` untouched.
 */
export function serializeMediaQuery(query: MediaQuery, search = ''): string {
  return serializeTableState({ ...query, columns: undefined }, DEFAULT_ORDER, search);
}

/**
 * A search string without the `details` deep-link param, in `location.search` form.
 * The per-folder memory stores this, so returning to a folder never reopens a details popup.
 */
export function stripDetailsParam(search: string): string {
  const query = stringifySearchParams({ ...parseSearchParams(search), details: undefined });
  return query === '' ? '' : `?${query}`;
}

/**
 * The absolute URL of a file's bytes: the record's root-relative `url` resolved against the API base URL.
 * An absolute `url`, from a configured public origin, passes through; a folder has none.
 */
export function resolveUploadURL(record: UploadRecord): string | undefined {
  return isUndefined(record.url) ? undefined : new URL(record.url, dashboardConfig().apiURL).href;
}

/**
 * The absolute URL an image tile shows: the `thumbnail` variant when there is one, else the original.
 * `_updatedAt` rides along as a version, so a replaced file's tile refetches instead of showing cached bytes.
 */
export function previewURL(record: UploadRecord): string {
  const source = record.variants?.thumbnail ?? record.url ?? '';
  return versionedURL(new URL(source, dashboardConfig().apiURL).href, record._updatedAt);
}

/**
 * Loads one page of a folder's grid; a failure resolves `undefined`.
 * Without a filter the page lists the folder's children; with one, the filter runs over its subtree.
 * A translatable `Uploads` reads at the active content locale.
 * Descriptions and the filters over them then follow the language switcher.
 */
export function loadUploads(
  directory: string,
  query: MediaQuery,
): Promise<UploadsPage | undefined> {
  const body: Record<string, unknown> = {
    where: scopedWhere(directory, query.where),
    order: query.order,
    page: query.page,
    perPage: PER_PAGE,
  };
  const locale = uploadsCollection()?.translatable ? activeContentLocale() : undefined;
  if (!isUndefined(locale)) body.locale = locale;
  return loadPage('uploads', body) as Promise<UploadsPage | undefined>;
}

/**
 * How the folder at `directory` stands for the viewer; the root is always visible.
 * A scope may hide the row alone, so a hidden row still stands while a direct child is visible.
 */
export async function directoryPresence(directory: string): Promise<FolderPresence> {
  if (directory === '') return 'visible';
  const total = async (where: ConditionObject) =>
    (await loadPage('uploads', { where, select: ['UUID'], page: 1, perPage: 1 }))?.total;
  const row = await total(folderWhere(directory));
  return folderPresence(row, row === 0 ? await total({ directory }) : undefined);
}

/**
 * Which of `directories` are private folders, in one read; the root never is.
 * A failed read resolves an empty set, and the server still refuses to make a row inside one public.
 */
export async function privateFolders(directories: readonly string[]): Promise<ReadonlySet<string>> {
  const folders = uniqueArray(directories).filter((directory) => directory !== '');
  if (folders.length === 0) return new Set();
  const page = (await loadPage('uploads', {
    where: { and: [{ kind: 'folder', private: true }, { or: folders.map(folderWhere) }] },
    select: ['kind', 'directory', 'name'],
    page: 1,
    perPage: PER_PAGE,
  })) as UploadsPage | undefined;
  return new Set(page?.records.map((record) => record.path) ?? []);
}

/**
 * Asks every open media library to reload its page.
 */
export function refreshMedia(): void {
  dispatchTrigger(MEDIA_REFRESH);
}

/**
 * Moves records into `directory` in one request, all or nothing.
 * Rows already there, and folders that would move into themselves, stay out of the request.
 * The server takes a row inside a moving folder along with it.
 * Refreshes the libraries and toasts the moved count.
 * A taken name toasts the conflict, any other refusal its reason, and nothing moves.
 * Resolves the number of rows moved.
 */
export async function moveUploads(
  records: readonly UploadRecord[],
  directory: string,
): Promise<number> {
  const t = useUploadsT();
  const plan = movePlan(records, directory);
  if (plan.length > 0) {
    const refusal = await sendBulk('POST /uploads/move', { uuids: uuidsOf(plan), directory });
    if (!isUndefined(refusal)) {
      const conflict = !isEmpty(refusal.errors) && isUndefined(refusal.errors['']);
      toast(conflict ? t('uploads.dashboard.itemsConflict') : refusal.message, { type: 'error' });
      return 0;
    }
  }
  toast(t('uploads.dashboard.moved', { count: plan.length }), {
    type: plan.length > 0 ? 'success' : 'default',
  });
  return plan.length;
}

/**
 * Makes records private or public in one request, all or nothing.
 * The server takes a folder's contents along, so the rows go as given.
 * Refreshes the libraries and toasts the changed count.
 * A refusal toasts the refused change with its reason, and nothing changes.
 * Resolves the number of rows changed.
 */
export async function setUploadsPrivate(
  records: readonly UploadRecord[],
  value: boolean,
): Promise<number> {
  if (records.length === 0) return 0;
  const t = useUploadsT();
  const count = records.length;
  const refusal = await sendBulk('POST /uploads/private', {
    uuids: uuidsOf(records),
    private: value,
  });
  if (!isUndefined(refusal)) {
    const refused = value ? 'uploads.dashboard.notMadePrivate' : 'uploads.dashboard.notMadePublic';
    toast(t(refused, { count }), { type: 'error', description: refusal.message });
    return 0;
  }
  const key = value ? 'uploads.dashboard.madePrivate' : 'uploads.dashboard.madePublic';
  toast(t(key, { count }), { type: 'success' });
  return count;
}

/**
 * Asks the server for a link to a private file that anyone can open for `maxAge`, a duration like `7d`.
 * Resolves the absolute URL, or `undefined` when the server declined or could not be reached.
 */
export async function temporaryLink(uuid: string, maxAge: string): Promise<string | undefined> {
  try {
    const response = await api(`POST /uploads/${uuid}/link`, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ maxAge }),
    });
    if (!response.ok) return undefined;
    const { url } = (await response.json()) as { url: string };
    return new URL(url, dashboardConfig().apiURL).href;
  } catch {
    return undefined;
  }
}

/**
 * Confirms and deletes records in one request, all or nothing.
 * A row inside a selected folder is left out: the folder takes its subtree along.
 * The dialog names a single row, counts several, and notes the subtree when a folder is among them.
 * Refreshes the libraries and toasts the deleted count.
 * A refusal toasts its reason, and nothing is deleted.
 * A second call while one runs is ignored.
 */
export async function confirmDeleteUploads(records: readonly UploadRecord[]): Promise<void> {
  if (deleting) return;
  const t = useUploadsT();
  const targets = pruneDescendants(records);
  const [first] = targets;
  if (isUndefined(first)) return;
  const question =
    targets.length === 1
      ? t('uploads.dashboard.deleteConfirm', { name: first.name })
      : t('uploads.dashboard.deleteSelectedConfirm', { count: targets.length });
  const hasFolder = targets.some((record) => record.kind === 'folder');
  const action = await openDialog({
    content: hasFolder ? `${question}\n${t('uploads.dashboard.deleteFolderNote')}` : question,
    actions: [
      { name: 'cancel', label: t('dashboard.cancel') },
      { name: 'delete', label: t('dashboard.delete'), variant: 'destructive' },
    ],
  });
  if (action !== 'delete') return;
  deleting = true;
  const refusal = await sendBulk('POST /uploads/delete', { uuids: uuidsOf(targets) });
  deleting = false;
  if (isUndefined(refusal)) {
    toast(t('uploads.dashboard.deleted', { count: targets.length }), { type: 'success' });
  } else {
    toast(refusal.message, { type: 'error' });
  }
}

/**
 * Sends one bulk request and refreshes the libraries once the API answered, refused or not.
 * A refusal may name a row gone elsewhere, and the refresh drops it from the grid and the selection.
 * Resolves `undefined` on success, else the refusal: the answer's error, or that the API is unreachable.
 */
async function sendBulk(
  route: APIRouteID,
  body: Record<string, unknown>,
): Promise<WireError | undefined> {
  try {
    const response = await api(route, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    refreshMedia();
    if (!response.ok) return readWireError(response);
  } catch {
    return { errors: {}, message: useUploadsT()('dashboard.unreachable') };
  }
  return undefined;
}

/**
 * The `UUID`s of `records`, in order.
 */
function uuidsOf(records: readonly UploadRecord[]): string[] {
  return records.map((record) => record.UUID);
}
