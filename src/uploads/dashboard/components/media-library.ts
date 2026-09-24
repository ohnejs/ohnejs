import { activeContentLocale } from 'app/components/content-language-switcher.ts';
import {
  type Child,
  container,
  contextMenu,
  css,
  dashboardMeta,
  dropdownItem,
  each,
  h,
  type HotkeysOptions,
  icon,
  type IconName,
  lastNavigation,
  listenTrigger,
  navigate,
  type RouteContext,
  setDocumentTitle,
  useHotkeys,
  when,
} from 'ohnejs/dashboard';
import {
  debounce,
  effect,
  hasKey,
  isNull,
  isRealNumber,
  isUndefined,
  onCleanup,
  parseSearchParams,
  ref,
  stringifySearchParams,
  untracked,
} from 'ohnejs/utils';

import type { UploadRecord } from '../../uploads/types.ts';

import { mediaPopups } from './_media-popups.ts';
import { useUploadsT } from './_messages.ts';
import { mediaBreadcrumbs } from './media-breadcrumbs.ts';
import { mediaFooter } from './media-footer.ts';
import { detailsHref, type MediaItemDisabled } from './media-image-item.ts';
import { mediaItem, type MediaItemActions } from './media-item.ts';
import {
  confirmDeleteUploads,
  directoryPresence,
  loadUploads,
  mediaMemory,
  parseMediaQuery,
  privateFolders,
  resolveUploadURL,
  serializeMediaQuery,
  setUploadsPrivate,
  stripDetailsParam,
  uploadsCollection,
  uploadsPermissions,
} from './media-library-data.ts';
import {
  createMediaView,
  directoryFromParam,
  type MediaGroup,
  type MediaGroupField,
  groupUploads,
  MEDIA_REFRESH,
  mediaGroupField,
  mediaPath,
  type MediaQuery,
  type MediaSelectionMode,
  type MediaView,
  pageFolderHidden,
  PER_PAGE,
  pinned,
} from './media-library-state.ts';

/**
 * Everything the media page hands off to popups and the upload queue.
 * The tiles and the context menu take the record actions; the footer takes the create actions.
 */
export interface MediaActions extends MediaItemActions {
  /**
   * Called when the New folder button asks for a folder in `directory`.
   */
  onCreateFolder?(directory: string): void;

  /**
   * Called with the files picked through the Upload button, for `directory`.
   */
  onUpload?(files: File[], directory: string): void;
}

/**
 * Options for `mediaLibrary`.
 */
export interface MediaLibraryOptions {
  /**
   * The view the grid reads and selects through.
   */
  view: MediaView;

  /**
   * How the grid selects.
   *
   * @default
   * 'none'
   */
  selectionMode?: MediaSelectionMode;

  /**
   * Whether tiles show their record's path in a tooltip, read reactively.
   * Omitted shows paths while a filter is active, since the hits then come from anywhere in the subtree.
   */
  showPathTooltips?: () => boolean;

  /**
   * Whether a record's tile is disabled, and why; the picker greys out files a field cannot take.
   */
  disabled?(record: UploadRecord): MediaItemDisabled;

  /**
   * Called on a plain click of a tile instead of following its link.
   */
  onPick?(record: UploadRecord, event: MouseEvent): void;

  /**
   * The popups the tiles and the context menu open.
   */
  actions?: MediaItemActions;

  /**
   * How the grid's hotkeys attach; a popup passes `allowInOverlays` and its root as the target.
   */
  hotkeys?: HotkeysOptions;
}

let registered: MediaActions = {};

css`
  .o-media-library {
    display: flex;
    flex-direction: column;
    min-height: 100%;
  }

  .o-media-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(8rem, 1fr));
    gap: 0.75rem;
  }

  .o-media-group + .o-media-group {
    margin-top: 1.25rem;
  }

  .o-media-group-label {
    position: sticky;
    top: 0;
    z-index: 1;
    display: block;
    margin-bottom: 0.25rem;
    padding: 0.25rem 0;
    background-color: hsl(var(--ohne-background));
    color: hsl(var(--ohne-muted-foreground));
    font-size: 0.6875rem;
    font-weight: 600;
    line-height: calc(1em + 0.5rem);
    text-transform: uppercase;
  }

  /* A path keeps its own case: unlike the taxonomy labels, it names something case-sensitive. */
  .o-media-group-label-path {
    text-transform: none;
  }

  .o-media-group:first-child .o-media-group-label {
    margin-top: -0.25rem;
  }

  .o-media-empty {
    flex: 1;
    display: flex;
    justify-content: center;
    align-items: center;
    color: hsl(var(--ohne-muted-foreground));
    font-size: 0.875rem;
  }

  @media (max-width: 767px) {
    .o-media-grid {
      grid-template-columns: repeat(auto-fill, minmax(6rem, 1fr));
    }
  }

  .o-media-page {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .o-media-page-container > .ohne-container-content {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .o-media-page-header {
    padding: calc(0.75rem + 1px) 0.75rem 0.75rem;
    border-bottom-width: 1px;
    font-size: 0.875rem;
    font-weight: 500;
  }

  .o-media-page-main {
    flex: 1;
    container-type: inline-size;
    contain: layout;
    padding: 0.75rem;
  }

  .o-media-page-footer {
    container-type: inline-size;
    border-top-width: 1px;
    padding: 0.75rem;
  }

  .o-media-page-missing {
    height: 100%;
    display: grid;
    place-items: center;
    color: hsl(var(--ohne-muted-foreground));
  }
`;

/**
 * Registers the popups and the upload queue the media page hands off to.
 * A layer's dashboard boot file calls it once; the page reads the registration when it renders.
 */
export function registerMediaActions(actions: MediaActions): void {
  registered = { ...registered, ...actions };
}

/**
 * The actions registered through `registerMediaActions`.
 */
export function mediaActionsRegistry(): MediaActions {
  return registered;
}

/**
 * The media grid: one tile per record of the view's page, folders and files in read order.
 *
 * Sorting by kind, media type, or folder splits the page into runs under sticky labels.
 * Only a folder has no media type, so that run reads `Folders` under either field.
 * A directory or query change reloads with a short debounce; the `media:refresh` trigger reloads in place.
 * A folder with neither a visible row nor a visible child sends the view to the root.
 * A load clears the media page's selection, so no moved or deleted row lingers; a picker keeps its picks.
 * Shift ranges the selection from the checkbox, or from the tile itself once something is selected.
 * Escape clears, and Delete deletes.
 * Cmd/Ctrl+A selects the page, or clears the selection when the page is already selected.
 * A right-click opens the record's context menu: open, rename, move, details, delete.
 * A layer with private files adds make private or make public to it.
 * Empty folders say so once the read has answered.
 */
export function mediaLibrary(options: MediaLibraryOptions): HTMLElement {
  const t = useUploadsT();
  const view = options.view;
  const mode = options.selectionMode ?? 'none';
  const permissions = uploadsPermissions();
  const { canUpdate, canDelete } = permissions;
  const actions = options.actions ?? registered;
  const showPathTooltips =
    options.showPathTooltips ?? ((): boolean => !isUndefined(view.query.value.where));
  const selectable = (record: UploadRecord): boolean =>
    (mode !== 'multiple' || record.kind === 'file') && !(options.disabled?.(record).value ?? false);

  let shift = false;
  const onKey = (event: KeyboardEvent): void => {
    shift = event.shiftKey;
  };
  const onBlur = (): void => {
    shift = false;
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  window.addEventListener('blur', onBlur);
  onCleanup(() => {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKey);
    window.removeEventListener('blur', onBlur);
  });

  let renew: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(renew));
  const renewAt = (records: readonly UploadRecord[]): void => {
    clearTimeout(renew);
    const soonest = Math.min(...records.map((record) => record.expires ?? Infinity));
    if (isRealNumber(soonest)) renew = setTimeout(reload, Math.max(0, soonest - Date.now()));
  };

  let generation = 0;
  const load = async (): Promise<void> => {
    const mine = ++generation;
    const directory = untracked(() => view.directory.value);
    const query = untracked(() => view.query.value);
    const [page, presence] = await Promise.all([
      loadUploads(directory, query),
      directoryPresence(directory),
    ]);
    if (mine !== generation) return;
    view.hidden.value = presence === 'hidden';
    if (presence === 'missing') {
      view.uploads.value = [];
      view.paginated.value = { currentPage: 1, lastPage: 1, perPage: PER_PAGE, total: 0 };
      view.directory.value = '';
    } else if (!isUndefined(page)) {
      view.uploads.value = page.records;
      renewAt(page.records);
      view.privateFolders.value = new Set();
      if (mode === 'none' && canUpdate) {
        const locked = page.records.filter((record) => record.private === true);
        void privateFolders(locked.map((record) => record.directory)).then((folders) => {
          if (mine === generation) view.privateFolders.value = folders;
        });
      }
      view.paginated.value = {
        currentPage: page.page,
        lastPage: page.lastPage,
        perPage: page.perPage,
        total: page.total,
      };
      if (page.page > page.lastPage) view.push({ page: page.lastPage || 1 }, true);
    }
    view.ready.value = true;
    setTimeout(() => {
      if (mode === 'none') view.clearSelection();
      else view.origin.value = null;
    });
  };
  const reload = debounce(() => void load(), 100);
  onCleanup(reload.cancel);

  effect(() => {
    void view.directory.value;
    void view.query.value;
    // Read here, so a content-language switch reloads the grid at that locale.
    if (uploadsCollection()?.translatable) void activeContentLocale();
    untracked(() => {
      view.ready.value = false;
    });
    reload();
  });
  let seen = untracked(() => view.revision.value);
  effect(() => {
    const current = view.revision.value;
    if (current === seen) return;
    seen = current;
    reload();
  });
  listenTrigger(MEDIA_REFRESH, () => view.refresh());

  const menuEvent = ref<MouseEvent | TouchEvent | null>(null);
  let menuRecord: UploadRecord | null = null;
  const closeMenu = (): void => {
    menuEvent.value = null;
  };
  const menuItem = (
    glyph: IconName,
    label: string,
    onClick: () => void,
    extras: { href?: string; target?: string; destructive?: boolean } = {},
  ): HTMLElement => {
    const item = dropdownItem([icon(glyph), h('span', null, label)], {
      href: extras.href,
      target: extras.target,
      destructive: extras.destructive,
      onClick: () => {
        closeMenu();
        onClick();
      },
    });
    item.title = label;
    return item;
  };
  const menuItems = (): Child => {
    const record = menuRecord;
    if (isNull(record)) return null;
    const folder = record.kind === 'folder';
    const details = (): void => {
      if (actions.onDetails) actions.onDetails(record);
      else navigate(detailsHref(record, false));
    };
    return [
      folder
        ? menuItem('folder-open', t('dashboard.open'), () => {}, { href: mediaPath(record.path) })
        : menuItem('external-link', t('uploads.dashboard.openInNewTab'), () => {}, {
            href: resolveUploadURL(record),
            target: '_blank',
          }),
      canUpdate && actions.onRename
        ? menuItem('pencil', t('uploads.dashboard.rename'), () => actions.onRename?.(record))
        : null,
      canUpdate && actions.onMove
        ? menuItem('file-arrow-right', t('uploads.dashboard.move'), () =>
            actions.onMove?.([record]),
          )
        : null,
      canUpdate && !pinned(record, view.privateFolders.value)
        ? menuItem(
            record.private ? 'lock-open' : 'lock',
            t(record.private ? 'uploads.dashboard.makePublic' : 'uploads.dashboard.makePrivate'),
            () => void setUploadsPrivate([record], !record.private),
          )
        : null,
      folder ? null : menuItem('info-circle', t('uploads.dashboard.details'), details),
      canDelete ? h('hr') : null,
      canDelete
        ? menuItem('trash-x', t('dashboard.delete'), () => void confirmDeleteUploads([record]), {
            destructive: true,
          })
        : null,
    ];
  };
  const menu = mode === 'none' ? contextMenu(menuEvent, menuItems, { size: -1 }) : null;

  const hotkeys = useHotkeys(options.hotkeys);
  hotkeys.listen('selectAll', (event) => {
    if (mode === 'single' || !(canUpdate || canDelete)) return;
    const candidates = view.uploads.value.filter(selectable);
    if (candidates.length === 0) return;
    event.preventDefault();
    if (candidates.every((record) => view.isSelected(record.UUID))) view.clearSelection();
    else for (const record of candidates) view.select(record);
  });
  hotkeys.listen('close', (event) => {
    if (view.selection.value.length === 0) return;
    event.preventDefault();
    view.clearSelection();
  });
  hotkeys.listen('delete', () => {
    if (mode !== 'none' || !canDelete || view.selection.value.length === 0) return;
    void confirmDeleteUploads(view.selection.value);
  });

  const field = (): MediaGroupField | undefined => mediaGroupField(view.query.value.order);
  const groups = (): MediaGroup[] => {
    const grouping = field();
    const records = view.uploads.value;
    return isUndefined(grouping)
      ? [{ key: '', records: [...records] }]
      : groupUploads(records, grouping);
  };
  const labelClass = (grouping: MediaGroupField): string =>
    'o-media-group-label' + (grouping === 'directory' ? ' o-media-group-label-path' : '');
  const groupLabel = (grouping: MediaGroupField, key: string): string => {
    if (grouping === 'kind') {
      return t(key === 'folder' ? 'uploads.dashboard.folders' : 'uploads.dashboard.files');
    }
    if (grouping === 'directory') return key === '' ? t('uploads.dashboard.rootFolder') : key;
    return key === '' ? t('uploads.dashboard.folders') : key;
  };

  return h(
    'div',
    {
      class: () => 'o-media-library' + (view.moving.value ? ' o-media-library-moving' : ''),
    },
    when(
      () => view.uploads.value.length > 0 || !view.ready.value,
      () =>
        each(
          groups,
          (group) => group.key,
          (group) =>
            h(
              'div',
              { class: 'o-media-group' },
              () => {
                const grouping = field();
                if (isUndefined(grouping)) return null;
                return h('span', { class: labelClass(grouping) }, () =>
                  groupLabel(grouping, group().key),
                );
              },
              h(
                'div',
                { class: 'o-media-grid' },
                each(
                  () => group().records,
                  (record) => record.UUID,
                  (record) =>
                    mediaItem(record, {
                      view,
                      permissions,
                      selectionMode: mode,
                      showPathTooltip: showPathTooltips,
                      disabled: options.disabled,
                      onPick: options.onPick,
                      actions,
                      onContextMenu: isNull(menu)
                        ? undefined
                        : (target, event) => {
                            menuRecord = target;
                            menu.onContextMenu(event);
                          },
                      rangeKey: () => shift,
                    }),
                ),
              ),
            ),
        ),
      () =>
        h(
          'div',
          { class: 'o-media-empty' },
          h('span', null, () =>
            t(
              view.directory.value === ''
                ? 'uploads.dashboard.noUploads'
                : 'uploads.dashboard.folderEmpty',
            ),
          ),
        ),
    ),
    menu?.root,
  );
}

/**
 * The media page body: the breadcrumb header, the grid, and the footer, for the route's folder.
 *
 * The grid state rides in the URL as `page`, `order`, and `where`, exactly as a collection table's does.
 * The last query string per folder is remembered and restored when the folder is revisited bare.
 * Back and forward never restore, so a bare history entry stays bare.
 * A folder with neither a visible row nor a visible child sends the page to the root.
 * A viewer without read access to `Uploads` sees the no-permission line instead.
 * The actions default to the registration made through `registerMediaActions`.
 * The page hosts the create-folder, rename, move, and details popups.
 * A registered action overrides its popup.
 */
export function mediaLibraryPage(route: RouteContext, actions?: MediaActions): Child {
  const t = useUploadsT();
  const directory = directoryFromParam(route.params.path);
  effect(() => setDocumentTitle(t('uploads.dashboard.media')));
  return when(
    () => !isUndefined(dashboardMeta()),
    () =>
      isUndefined(uploadsCollection())
        ? h('div', { class: 'o-media-page-missing' }, () => t('uploads.dashboard.noPermission'))
        : mediaPage(directory, actions ?? registered),
  );
}

/**
 * The page frame around a folder: view state from the URL, the memory hand-off, header, grid, and footer.
 */
function mediaPage(directory: string, actions: MediaActions): Child {
  const remembered = mediaMemory.get(directory) ?? '';
  const redirected = location.search === '' && remembered !== '' && lastNavigation() !== 'popstate';
  if (redirected) {
    queueMicrotask(() => navigate(mediaPath(directory, remembered), { replace: true }));
    return null;
  }
  mediaMemory.set(directory, stripDetailsParam(location.search));

  const query = parseMediaQuery(location.search);
  const view = createMediaView({
    directory,
    query,
    push: (patch: Partial<MediaQuery>, replace = false) => {
      const next: MediaQuery = {
        page: patch.page ?? query.page,
        order: patch.order ?? query.order,
        where: hasKey(patch, 'where') ? patch.where : query.where,
      };
      const serialized = serializeMediaQuery(next, location.search);
      const search = serialized === '' ? '' : `?${serialized}`;
      mediaMemory.set(directory, stripDetailsParam(search));
      navigate(location.pathname + search, { replace });
    },
  });
  effect(() => {
    const target = view.directory.value;
    if (target !== directory) navigate(mediaPath(target));
  });

  effect(() => {
    pageFolderHidden.value = view.hidden.value;
  });
  onCleanup(() => {
    pageFolderHidden.value = false;
  });

  const popups = mediaPopups(view);
  const merged: MediaActions = { ...popups.actions, ...actions };

  const crumbSearch = (): string => {
    const params = stringifySearchParams({
      ...parseSearchParams(location.search),
      page: undefined,
    });
    return params === '' ? '' : `?${params}`;
  };

  const headerEl = h(
    'div',
    { class: 'o-media-page-header ohne-justify-between' },
    mediaBreadcrumbs({ view, search: crumbSearch }),
  );
  const mainEl = h('div', { class: 'o-media-page-main' }, mediaLibrary({ view, actions: merged }));
  const containerEl = container([headerEl, mainEl]);
  containerEl.classList.add('o-media-page-container', 'ohne-flex-1');
  const footerEl = h(
    'div',
    { class: 'o-media-page-footer' },
    mediaFooter({
      view,
      onMove: merged.onMove,
      onCreateFolder: merged.onCreateFolder,
      onUpload: merged.onUpload,
    }),
  );

  return h('div', { class: 'o-media-page' }, containerEl, footerEl, popups.hosts);
}
