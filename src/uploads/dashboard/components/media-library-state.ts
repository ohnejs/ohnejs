import {
  extname,
  first,
  isArray,
  isNull,
  isPlainObject,
  isRealNumber,
  isString,
  isUndefined,
  last,
  longTimeout,
  onCleanup,
  ref,
  slugify,
  slugifyFileName,
  type ConditionObject,
  type Ref,
} from 'ohnejs/utils';

import type { UploadRecord } from '../../uploads/types.ts';

/**
 * The query a media view reads with: the page, the order strings, and the applied filter.
 */
export interface MediaQuery {
  /**
   * The one-based page number.
   *
   * @default
   * 1
   */
  page: number;

  /**
   * The ohne order strings, a leading `-` meaning descending.
   */
  order: string[];

  /**
   * The applied filter, in the exact shape the body-query endpoint reads.
   * Absent means the folder's direct children; present, the search covers the folder's subtree.
   */
  where: ConditionObject | undefined;
}

/**
 * The pagination a loaded page answers with.
 */
export interface MediaPagination {
  /**
   * The one-based page the records belong to.
   */
  currentPage: number;

  /**
   * The last page number, `1` for an empty folder.
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
 * How the library selects: `none` on the media page, `single` and `multiple` inside the picker.
 */
export type MediaSelectionMode = 'none' | 'single' | 'multiple';

/**
 * The order fields whose leading position splits the grid into labelled groups.
 */
export type MediaGroupField = 'kind' | 'type' | 'directory';

/**
 * One run of the loaded page: the records that share a value of the grouping field.
 */
export interface MediaGroup {
  /**
   * The shared value, `''` where the field is null: a folder's `type`, the root's `directory`.
   */
  key: string;

  /**
   * The records of the run, in read order.
   */
  records: UploadRecord[];
}

/**
 * One breadcrumb segment of a folder path.
 */
export interface MediaBreadcrumb {
  /**
   * The segment's own name.
   */
  name: string;

  /**
   * The folder path up to and including this segment.
   */
  path: string;
}

/**
 * The reactive state one media library surface shares between its breadcrumbs, grid, and footer.
 */
export interface MediaView {
  /**
   * The folder shown, `''` at the root.
   */
  directory: Ref<string>;

  /**
   * The page, order, and filter the grid reads with; write it through `push`.
   */
  query: Ref<MediaQuery>;

  /**
   * Applies a query patch where the owner keeps its state: the URL on the page, memory in a popup.
   * A patched `where` or `order` should come with `page: 1`.
   * `replace` asks a history-backed owner to swap its entry instead of pushing one.
   */
  push(patch: Partial<MediaQuery>, replace?: boolean): void;

  /**
   * The pagination of the last loaded page.
   */
  paginated: Ref<MediaPagination>;

  /**
   * Whether the first read for the current folder and query has answered.
   */
  ready: Ref<boolean>;

  /**
   * The records of the loaded page, in read order.
   */
  uploads: Ref<readonly UploadRecord[]>;

  /**
   * The page's directories that are private folders, known only to a viewer who may make rows public.
   */
  privateFolders: Ref<ReadonlySet<string>>;

  /**
   * Whether the read scope hides the shown folder's own row, so the viewer only sees into it.
   */
  hidden: Ref<boolean>;

  /**
   * The selected records, in pick order.
   */
  selection: Ref<readonly UploadRecord[]>;

  /**
   * The record a shift-click ranges from: the last plainly selected one, `null` once it leaves the page.
   */
  origin: Ref<UploadRecord | null>;

  /**
   * Whether a drag-to-move is in progress, so folder tiles and breadcrumbs accept drops.
   */
  moving: Ref<boolean>;

  /**
   * Bumped by `refresh`; the grid reloads when it changes.
   */
  revision: Ref<number>;

  /**
   * Reloads the current page.
   */
  refresh(): void;

  /**
   * Adds a record to the selection.
   * With `range`, selects everything between the origin and the record instead, in visual order.
   */
  select(record: UploadRecord, range?: boolean): void;

  /**
   * Removes a record from the selection.
   * With `range` and an origin, a deselect on a multi-selection ranges to the record instead.
   */
  deselect(record: UploadRecord, range?: boolean): void;

  /**
   * Empties the selection.
   */
  clearSelection(): void;

  /**
   * Whether the record with the `UUID` is selected.
   */
  isSelected(uuid: string): boolean;
}

/**
 * Options for `createMediaView`.
 */
export interface MediaViewOptions {
  /**
   * The folder shown first.
   *
   * @default
   * ''
   */
  directory?: string;

  /**
   * The query read with first; omitted members take the defaults.
   */
  query?: Partial<MediaQuery>;

  /**
   * Where a query patch lands.
   * Omitted writes the view's own `query`, so the grid reloads in place.
   */
  push?(patch: Partial<MediaQuery>, replace?: boolean): void;

  /**
   * Which records a range selection may include.
   * Omitted admits every record.
   */
  selectable?(record: UploadRecord): boolean;
}

/**
 * The trigger name every media mutation dispatches, so each open library reloads its page.
 */
export const MEDIA_REFRESH = 'media:refresh';

/**
 * Whether the media page shows a folder whose own row the read scope hides.
 * The page keeps it in step with its view, so the window-wide drop target stays shut there.
 */
export const pageFolderHidden: Ref<boolean> = ref(false);

/**
 * The page size the grid reads with.
 * A grid of 50 thumbnails stays light with lazy images, and paging beyond it costs one click.
 */
export const PER_PAGE = 50;

/**
 * The order the grid sorts by when the query declares none: folders first, then by name.
 * `kind` sorts `file` before `folder`, so descending puts folders first.
 */
export const DEFAULT_ORDER: readonly string[] = ['-kind', 'name'];

const GROUP_FIELDS: readonly MediaGroupField[] = ['kind', 'type', 'directory'];

/**
 * The image types a browser renders in an `<img>`; any other image file shows the file tile.
 */
export const DISPLAYABLE_IMAGE_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/pjpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/avif',
  'image/vnd.mozilla.apng',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/bmp',
  'image/x-windows-bmp',
]);

const SLASHES = /^\/+|\/+$/g;

/**
 * Creates the shared state of one media library surface.
 * The selection keeps pick order and dedupes by `UUID`; a range selection walks `uploads` in visual order.
 *
 * @example
 * ```ts
 * const view = createMediaView({ directory: 'photos' })
 *
 * view.select(sunset)        // selection: [sunset], origin: sunset
 * view.select(dusk, true)    // selection: everything from sunset to dusk
 * view.deselect(sunset)      // selection without sunset, origin: null
 * ```
 */
export function createMediaView(options: MediaViewOptions = {}): MediaView {
  const directory = ref(options.directory ?? '');
  const query = ref<MediaQuery>({
    page: 1,
    order: [...DEFAULT_ORDER],
    where: undefined,
    ...options.query,
  });
  const paginated = ref<MediaPagination>({
    currentPage: query.value.page,
    lastPage: 1,
    perPage: PER_PAGE,
    total: 0,
  });
  const ready = ref(false);
  const uploads = ref<readonly UploadRecord[]>([]);
  const privateFolders = ref<ReadonlySet<string>>(new Set());
  const hidden = ref(false);
  const selection = ref<readonly UploadRecord[]>([]);
  const origin = ref<UploadRecord | null>(null);
  const moving = ref(false);
  const revision = ref(0);
  const selectable = options.selectable ?? ((): boolean => true);

  const isSelected = (uuid: string): boolean =>
    selection.value.some((record) => record.UUID === uuid);

  const write = (next: readonly UploadRecord[]): void => {
    selection.value = next;
    const current = origin.value;
    if (!isNull(current) && !next.some((record) => record.UUID === current.UUID)) {
      origin.value = null;
    }
  };

  const select = (record: UploadRecord, range = false): void => {
    const from = origin.value;
    if (range && !isNull(from)) {
      const picked = rangeBetween(uploads.value, from.UUID, record.UUID).filter(selectable);
      write(uniqueByUUID([...selection.value, ...picked]));
    } else if (!isSelected(record.UUID)) {
      origin.value = record;
      write([...selection.value, record]);
    }
  };

  const deselect = (record: UploadRecord, range = false): void => {
    const alone = selection.value.length === 1 && first(selection.value)?.UUID === record.UUID;
    if (range && !isNull(origin.value) && !alone) {
      select(record, true);
    } else {
      write(selection.value.filter((entry) => entry.UUID !== record.UUID));
      origin.value = null;
    }
  };

  return {
    directory,
    query,
    push:
      options.push ??
      ((patch): void => {
        query.value = { ...query.value, ...patch };
      }),
    paginated,
    ready,
    uploads,
    privateFolders,
    hidden,
    selection,
    origin,
    moving,
    revision,
    refresh: () => {
      revision.value += 1;
    },
    select,
    deselect,
    clearSelection: () => write([]),
    isSelected,
  };
}

/**
 * The folder a `[...path]` route param names: slashes trimmed, `''` for the root.
 *
 * @example
 * ```ts
 * directoryFromParam('photos/2024/') // -> 'photos/2024'
 * directoryFromParam(undefined)      // -> ''
 * ```
 */
export function directoryFromParam(param: string | undefined): string {
  return (param ?? '').replace(SLASHES, '');
}

/**
 * The dashboard path of a folder, with an optional query string appended.
 *
 * @example
 * ```ts
 * mediaPath('')                   // -> '/media'
 * mediaPath('photos/2024')        // -> '/media/photos/2024'
 * mediaPath('photos', '?page=2')  // -> '/media/photos?page=2'
 * ```
 */
export function mediaPath(directory: string, search = ''): string {
  return (directory === '' ? '/media' : `/media/${directory}`) + search;
}

/**
 * The breadcrumb segments of a folder path, each with the path up to it.
 *
 * @example
 * ```ts
 * breadcrumbsOf('photos/2024')
 * // -> [{ name: 'photos', path: 'photos' }, { name: '2024', path: 'photos/2024' }]
 *
 * breadcrumbsOf('')
 * // -> []
 * ```
 */
export function breadcrumbsOf(directory: string): MediaBreadcrumb[] {
  if (directory === '') return [];
  const segments = directory.split('/');
  return segments.map((name, index) => ({ name, path: segments.slice(0, index + 1).join('/') }));
}

/**
 * The `where` that finds the folder row at `path`.
 *
 * @example
 * ```ts
 * folderWhere('photos')      // -> { kind: 'folder', directory: '', name: 'photos' }
 * folderWhere('photos/2024') // -> { kind: 'folder', directory: 'photos', name: '2024' }
 * ```
 */
export function folderWhere(path: string): ConditionObject {
  const slash = path.lastIndexOf('/');
  const directory = slash === -1 ? '' : path.slice(0, slash);
  return { kind: 'folder', directory, name: path.slice(slash + 1) };
}

/**
 * How a folder stands for the viewer: its row visible, only its contents visible, or nothing at all.
 */
export type FolderPresence = 'visible' | 'hidden' | 'missing';

/**
 * How a folder stands, from the totals of reading its own row and its direct children.
 * An unanswered read is `undefined` and never counts as missing, so a network blip keeps the viewer in place.
 *
 * @example
 * ```ts
 * folderPresence(1, undefined) // -> 'visible'
 * folderPresence(0, 3)         // -> 'hidden'
 * folderPresence(0, 0)         // -> 'missing'
 * ```
 */
export function folderPresence(
  row: number | undefined,
  inside: number | undefined,
): FolderPresence {
  if (row !== 0) return 'visible';
  return inside === 0 ? 'missing' : 'hidden';
}

/**
 * Whether a private record sits directly inside one of the private `folders`, so it cannot be made public.
 *
 * @example
 * ```ts
 * pinned({ private: true, directory: 'vault' }, new Set(['vault']))  // -> true
 * pinned({ private: true, directory: 'photos' }, new Set(['vault'])) // -> false
 * pinned({ private: false, directory: 'vault' }, new Set(['vault'])) // -> false
 * ```
 */
export function pinned(
  record: Pick<UploadRecord, 'private' | 'directory'>,
  folders: ReadonlySet<string>,
): boolean {
  return record.private === true && folders.has(record.directory);
}

/**
 * The field a page groups under: the primary order field, when the grid labels runs of it.
 * Every other order groups nothing, so the whole page reads as one plain run.
 *
 * @example
 * ```ts
 * mediaGroupField(['-kind', 'name']) // -> 'kind'
 * mediaGroupField(['type'])          // -> 'type'
 * mediaGroupField(['name'])          // -> undefined
 * mediaGroupField([])                // -> undefined
 * ```
 */
export function mediaGroupField(order: readonly string[]): MediaGroupField | undefined {
  const primary = first(order);
  if (isUndefined(primary)) return undefined;
  const name = primary.startsWith('-') ? primary.slice(1) : primary;
  return GROUP_FIELDS.find((field) => field === name);
}

/**
 * Splits `records` into runs of neighbours sharing their `field` value, in read order.
 * The read already ordered by `field`, so one run is one group; a null value keys as `''`.
 *
 * @example
 * ```ts
 * groupUploads([photos, sunset, dusk], 'kind')
 * // -> [{ key: 'folder', records: [photos] }, { key: 'file', records: [sunset, dusk] }]
 * ```
 */
export function groupUploads(
  records: readonly UploadRecord[],
  field: MediaGroupField,
): MediaGroup[] {
  const groups: MediaGroup[] = [];
  for (const record of records) {
    const key = record[field] ?? '';
    const open = last(groups);
    if (!isUndefined(open) && open.key === key) open.records.push(record);
    else groups.push({ key, records: [record] });
  }
  return groups;
}

/**
 * The `where` a folder's page reads with.
 * Without a filter it is the folder's direct children.
 * With one, the filter applies to the folder's whole subtree, the root's subtree being everything.
 *
 * @example
 * ```ts
 * scopedWhere('photos', undefined)
 * // -> { directory: 'photos' }
 *
 * scopedWhere('', { kind: 'file' })
 * // -> { kind: 'file' }
 *
 * scopedWhere('a', { kind: 'file' })
 * // -> { and: [{ or: [{ directory: 'a' }, { directory: { startsWith: 'a/' } }] }, { kind: 'file' }] }
 * ```
 */
export function scopedWhere(
  directory: string,
  where: ConditionObject | undefined,
): ConditionObject {
  if (isUndefined(where)) return { directory };
  if (directory === '') return where;
  const subtree: ConditionObject = {
    or: [{ directory }, { directory: { startsWith: `${directory}/` } }],
  };
  return { and: [subtree, where] };
}

/**
 * The filter a keyword search applies: files whose name contains every word.
 * Each word becomes the file name it would be stored as, since stored names are slugs.
 * So `Café` finds `cafe-menu.png`, and a word with nothing to slug drops.
 * A keyword with no word left is no filter.
 *
 * @example
 * ```ts
 * searchWhere('Café')
 * // -> { kind: 'file', name: { contains: 'cafe' } }
 *
 * searchWhere('sun Set.JPG')
 * // -> { kind: 'file', and: [{ name: { contains: 'sun' } }, { name: { contains: 'set.jpg' } }] }
 *
 * searchWhere('  !! ')
 * // -> undefined
 * ```
 */
export function searchWhere(keyword: string): ConditionObject | undefined {
  const words = keyword
    .trim()
    .split(/\s+/)
    .filter((word) => slugify(word) !== '')
    .map((word) => slugifyFileName(word));
  const [first] = words;
  if (isUndefined(first)) return undefined;
  if (words.length === 1) return { kind: 'file', name: { contains: first } };
  return { kind: 'file', and: words.map((word) => ({ name: { contains: word } })) };
}

/**
 * The keyword a filter was searched with, the inverse of `searchWhere`.
 * It reads back the stored-name words, so `Café` returns as `cafe`.
 * A filter of any other shape reads as `''`, so the search box only ever shows its own work.
 *
 * @example
 * ```ts
 * searchKeyword({ kind: 'file', name: { contains: 'sunset' } })
 * // -> 'sunset'
 *
 * searchKeyword({ kind: 'file', and: [{ name: { contains: 'a' } }, { name: { contains: 'b' } }] })
 * // -> 'a b'
 *
 * searchKeyword({ size: { atLeast: 1 } })
 * // -> ''
 * ```
 */
export function searchKeyword(where: ConditionObject | undefined): string {
  if (isUndefined(where) || where.kind !== 'file' || Object.keys(where).length !== 2) return '';
  const words = isArray<ConditionObject[]>(where.and)
    ? where.and.map(containedName)
    : [containedName(where)];
  return words.every(isString) ? words.join(' ') : '';
}

/**
 * The records to delete when a selection is deleted: rows inside a selected folder go with it.
 *
 * @example
 * ```ts
 * pruneDescendants([photos, photosSunset, notes]) // -> [photos, notes]
 * ```
 */
export function pruneDescendants(records: readonly UploadRecord[]): UploadRecord[] {
  const folders = records.filter((record) => record.kind === 'folder').map((record) => record.path);
  return records.filter(
    (record) => !folders.some((folder) => record.path.startsWith(`${folder}/`)),
  );
}

/**
 * The records a move to `directory` sends, deepest path first.
 * Rows already there stay, and a folder never moves into itself or below.
 *
 * @example
 * ```ts
 * movePlan([sunset, photos], 'archive')  // -> [sunset, photos], deepest path first
 * movePlan([photos], 'photos/2024')      // -> []
 * ```
 */
export function movePlan(records: readonly UploadRecord[], directory: string): UploadRecord[] {
  return records
    .filter((record) => record.directory !== directory && !isBelow(directory, record))
    .sort((a, b) => b.path.length - a.path.length);
}

/**
 * The records between two `UUID`s in a list, in visual order, reversed when the origin comes later.
 * The origin is always included; an unknown origin yields the target alone.
 *
 * @example
 * ```ts
 * rangeBetween([a, b, c, d], a.UUID, c.UUID) // -> [a, b, c]
 * rangeBetween([a, b, c, d], c.UUID, a.UUID) // -> [c, b, a]
 * rangeBetween([a, b, c, d], 'gone', b.UUID) // -> [b]
 * ```
 */
export function rangeBetween(
  list: readonly UploadRecord[],
  origin: string,
  target: string,
): UploadRecord[] {
  const originIndex = list.findIndex((record) => record.UUID === origin);
  const targetIndex = list.findIndex((record) => record.UUID === target);
  if (originIndex === -1 || targetIndex === -1) {
    return list.filter((record) => record.UUID === target);
  }
  const [start, end] =
    originIndex < targetIndex ? [originIndex, targetIndex] : [targetIndex, originIndex];
  const picked = list.slice(start, end + 1);
  return originIndex > targetIndex ? picked.reverse() : picked;
}

/**
 * Returns a scheduler that calls `reload` once the soonest `expires` among the given records passes.
 * Each call replaces the pending reload; disposing the creating scope cancels it.
 * Each `expires` value reloads once, so an answer that brings the same value back never loops.
 *
 * @example
 * ```ts
 * const renewAt = expiryRenewal(reload)
 *
 * renewAt(page.records) // reloads when the first private link expires
 * ```
 */
export function expiryRenewal(reload: () => void): (records: readonly UploadRecord[]) => void {
  let cancel = (): void => {};
  let renewed: number | undefined;
  onCleanup(() => cancel());
  return (records) => {
    cancel();
    const soonest = Math.min(...records.map((record) => record.expires ?? Infinity));
    if (!isRealNumber(soonest) || soonest === renewed) return;
    cancel = longTimeout(() => {
      renewed = soonest;
      reload();
    }, soonest - Date.now());
  };
}

/**
 * A file name split into its stem and its extension without the dot, `''` when it has none.
 *
 * @example
 * ```ts
 * splitFileName('sunset.jpg')      // -> { stem: 'sunset', extension: 'jpg' }
 * splitFileName('archive.tar.gz')  // -> { stem: 'archive.tar', extension: 'gz' }
 * splitFileName('notes')           // -> { stem: 'notes', extension: '' }
 * ```
 */
export function splitFileName(name: string): { stem: string; extension: string } {
  const suffix = extname(name);
  return { stem: suffix ? name.slice(0, -suffix.length) : name, extension: suffix.slice(1) };
}

/**
 * Whether a record is an image file the browser renders in an `<img>`.
 */
export function isDisplayableImage(record: UploadRecord): boolean {
  return record.kind === 'file' && !isNull(record.type) && DISPLAYABLE_IMAGE_TYPES.has(record.type);
}

/**
 * Whether `directory` is a folder record's own path or sits anywhere beneath it.
 */
function isBelow(directory: string, record: UploadRecord): boolean {
  return (
    record.kind === 'folder' &&
    (directory === record.path || directory.startsWith(`${record.path}/`))
  );
}

/**
 * The word a `{ name: { contains } }` condition searches for, `undefined` for any other shape.
 */
function containedName(condition: unknown): string | undefined {
  if (!isPlainObject<ConditionObject>(condition)) return undefined;
  const { name } = condition;
  if (!isPlainObject<ConditionObject>(name) || Object.keys(name).length !== 1) return undefined;
  return isString(name.contains) ? name.contains : undefined;
}

/**
 * The records with each `UUID` kept once, at its first position.
 */
function uniqueByUUID(records: readonly UploadRecord[]): UploadRecord[] {
  const seen = new Map<string, UploadRecord>();
  for (const record of records) {
    if (!seen.has(record.UUID)) seen.set(record.UUID, record);
  }
  return [...seen.values()];
}
