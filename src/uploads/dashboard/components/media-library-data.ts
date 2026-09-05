import { loadPage } from 'app/components/collection-table-data.ts';
import { parseTableState, serializeTableState } from 'app/components/collection-table-state.ts';
import { activeContentLocale } from 'app/components/content-language-switcher.ts';
import {
  api,
  type DashboardCollection,
  dashboardConfig,
  dashboardMeta,
  dispatchTrigger,
  openDialog,
  toast,
} from 'ohne/dashboard';
import {
  hasCapability,
  isUndefined,
  parseSearchParams,
  stringifySearchParams,
  untracked,
} from 'ohne/utils';

import type { UploadRecord } from '../../uploads/types.ts';

import { runBatched } from './_batch.ts';
import { useUploadsT } from './_messages.ts';
import {
  DEFAULT_ORDER,
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
 * How many move or delete requests run at once.
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
 * The absolute URL an image tile shows: the signed `thumbnail` when a service renders one, else the original.
 */
export function previewURL(record: UploadRecord): string {
  return new URL(record.thumbnail ?? record.url ?? '', dashboardConfig().apiURL).href;
}

/**
 * Loads one page of a folder's grid; a failure resolves `undefined`.
 * Without a filter the page lists the folder's children; with one, the filter runs over its subtree.
 * A translatable `Uploads` reads at the active content locale.
 * Descriptions and the filters over them then follow the language switcher.
 * Call it inside the load effect, so a language switch reloads the page.
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
 * Whether a folder row exists at `directory`; the root always does.
 * A failed read resolves `true`, so a network blip never bounces the viewer to the root.
 */
export async function directoryExists(directory: string): Promise<boolean> {
  if (directory === '') return true;
  const slash = directory.lastIndexOf('/');
  const parent = slash === -1 ? '' : directory.slice(0, slash);
  const name = directory.slice(slash + 1);
  const page = await loadPage('uploads', {
    where: { kind: 'folder', directory: parent, name },
    select: ['UUID'],
    page: 1,
    perPage: 1,
  });
  return isUndefined(page) || page.total > 0;
}

/**
 * Asks every open media library to reload its page.
 */
export function refreshMedia(): void {
  dispatchTrigger(MEDIA_REFRESH);
}

/**
 * Moves records into `directory`, one `PATCH` each with bounded concurrency, deepest path first.
 * Rows already there and folders that would move into themselves stay put.
 * Refreshes the libraries and toasts the moved count; a taken name toasts the conflict.
 * Resolves the number of rows moved.
 */
export async function moveUploads(
  records: readonly UploadRecord[],
  directory: string,
): Promise<number> {
  const t = useUploadsT();
  const results = await runBatched(movePlan(records, directory), BATCH_LIMIT, (record) =>
    api(`PATCH /uploads/${record.UUID}`, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ directory }),
    }),
  );
  const moved = results.filter((result) => landed(result)).length;
  const conflicts = results.filter(
    (result) => result.status === 'fulfilled' && result.value.status === 422,
  ).length;
  if (moved > 0) refreshMedia();
  if (conflicts > 0) toast(t('uploads.dashboard.itemsConflict'), { type: 'error' });
  if (moved > 0 || conflicts === 0) {
    toast(t('uploads.dashboard.moved', { count: moved }), {
      type: moved > 0 ? 'success' : 'default',
    });
  }
  return moved;
}

/**
 * Confirms and deletes records, one `DELETE` each with bounded concurrency.
 * A row inside a selected folder is pruned first: the folder's delete takes its subtree along.
 * The dialog names a single row, counts several, and notes the subtree when a folder is among them.
 * Refreshes the libraries and toasts the deleted count.
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
  const results = await runBatched(targets, BATCH_LIMIT, (record) =>
    api(`DELETE /uploads/${record.UUID}`),
  );
  deleting = false;
  const deleted = results.filter((result) => landed(result)).length;
  if (deleted > 0) refreshMedia();
  toast(t('uploads.dashboard.deleted', { count: deleted }), {
    type: deleted > 0 ? 'success' : 'error',
  });
}

/**
 * Whether a settled request answered with a success status.
 */
function landed(result: PromiseSettledResult<Response>): boolean {
  return result.status === 'fulfilled' && result.value.ok;
}
