import { clearSelectionButton } from 'app/components/clear-selection-button.ts';
import { readableFields, sortableFields } from 'app/components/collection-table-data.ts';
import { filterPopup } from 'app/components/filter-popup.ts';
import { sortingPopup } from 'app/components/sorting-popup.ts';
import {
  attachTooltip,
  bubble,
  button,
  css,
  formField,
  h,
  hasModifierKey,
  type IconName,
  isEditingText,
  overlayCount,
  pagination,
  popup,
  textInput,
  useHotkeys,
  when,
} from 'ohnejs/dashboard';
import {
  type ConditionObject,
  effect,
  first,
  isUndefined,
  nextTick,
  onCleanup,
  ref,
  untracked,
} from 'ohnejs/utils';

import type { UploadRecord } from '../../uploads/types.ts';

import { useUploadsT } from './_messages.ts';
import { mediaActions } from './media-actions.ts';
import {
  confirmDeleteUploads,
  setUploadsPrivate,
  uploadsCollection,
  uploadsPermissions,
} from './media-library-data.ts';
import {
  DEFAULT_ORDER,
  type MediaSelectionMode,
  type MediaView,
  pinned,
  searchKeyword,
  searchWhere,
} from './media-library-state.ts';

/**
 * Options for `mediaFooter`.
 */
export interface MediaFooterOptions {
  /**
   * The view the footer pages, filters, sorts, and acts on.
   */
  view: MediaView;

  /**
   * How the library selects.
   * `none` shows the selection cluster and the create buttons; `multiple` shows Apply instead.
   *
   * @default
   * 'none'
   */
  selectionMode?: MediaSelectionMode;

  /**
   * Called with the selection when the Move button asks for the folder picker.
   * Without it the button stays hidden.
   */
  onMove?(records: readonly UploadRecord[]): void;

  /**
   * Called when the New folder button asks for a folder in the view's directory.
   */
  onCreateFolder?(directory: string): void;

  /**
   * Called with the files picked through the Upload button, for the view's directory.
   */
  onUpload?(files: File[], directory: string): void;

  /**
   * Called with the URL entered through the upload-from-URL button, for the view's directory.
   */
  onUploadURL?(url: string, directory: string): void;

  /**
   * Called when the Apply button applies a multiple-mode selection.
   */
  onApply?(): void;
}

const COMPACT_FOOTER_WIDTH = 768;

css`
  .o-media-footer {
    font-size: 0.875rem;
  }

  .o-media-footer .ohne-pagination-buttons {
    margin: -0.75rem -0.25rem;
    padding: 0.75rem 0.25rem;
  }

  .o-media-footer-search-buttons {
    justify-content: flex-end;
    margin-top: 0.75rem;
  }

  .o-media-footer-search-title {
    font-weight: 500;
  }

  @container (max-width: 767px) {
    .o-media-footer-has-selection .ohne-pagination {
      display: none;
    }

    .o-media-footer > .ohne-row {
      flex-wrap: wrap;
      justify-content: flex-end;
    }
  }
`;

/**
 * The footer row: pagination on the left, the action cluster on the right.
 * The cluster holds the selection actions while something is selected, then search, filter, and sorting.
 * The selection actions are delete, clear, select all, move, make private, and make public.
 * Select all shows while a record on the page is left out.
 * Make private shows while a public item is selected, make public while a private one is.
 * On the page it ends with New folder, upload from URL, and Upload; in a multiple picker with Apply.
 * The create buttons stay hidden in a folder whose own row the scope hides.
 * Left and right arrows page while no overlay sits above the footer's own surface.
 * Cmd/Ctrl+K opens the search popup, whose keyword filters file names across the folder's subtree.
 */
export function mediaFooter(options: MediaFooterOptions): HTMLElement {
  const t = useUploadsT();
  const view = options.view;
  const mode = options.selectionMode ?? 'none';
  const { canMove, canSetPrivate, canDelete } = uploadsPermissions();
  const collection = uploadsCollection();
  const selectionCount = (): number => view.selection.value.length;
  const hasSelection = (): boolean => mode === 'none' && selectionCount() > 0;
  const keyword = (): string => searchKeyword(view.query.value.where);
  const whereDirty = (): boolean => !isUndefined(view.query.value.where);
  const orderDirty = (): boolean => view.query.value.order.join(',') !== DEFAULT_ORDER.join(',');
  const compact = ref(false);
  const searchOpen = ref(false);
  const filterOpen = ref(false);
  const sortingOpen = ref(false);

  const paginationEl = pagination({
    currentPage: () => view.paginated.value.currentPage,
    lastPage: () => view.paginated.value.lastPage,
    goToPageTitle: () => t('dashboard.pagination.goToPage'),
    nextPageTitle: () => t('dashboard.pagination.next'),
    previousPageTitle: () => t('dashboard.pagination.previous'),
    onChange: (page) => view.push({ page }),
    button: ({ currentPage, index, onClick }) => {
      const el = h(
        'button',
        {
          type: 'button',
          class:
            'ohne-pagination-button ohne-raw' +
            (currentPage === index ? ' ohne-pagination-button-active' : ''),
          onClick: () => onClick(),
        },
        index,
      );
      onCleanup(
        attachTooltip(el, () => {
          const { perPage, total } = view.paginated.value;
          return t('dashboard.pagination.showingRecords', {
            from: (index - 1) * perPage + 1,
            to: Math.min(index * perPage, total),
          });
        }),
      );
      return el;
    },
  });

  const iconButton = (
    glyph: IconName,
    tooltip: () => string,
    onClick: () => void,
    extras: { variant?: 'accent' | 'destructive' | 'outline'; dirty?: () => boolean } = {},
  ): HTMLElement => {
    const el = button(tooltip, {
      icon: glyph,
      iconOnly: true,
      variant: extras.variant ?? 'outline',
      bubble: extras.dirty ? () => (extras.dirty?.() ? bubble() : null) : undefined,
      onClick,
    });
    if (extras.dirty) {
      const dirty = extras.dirty;
      effect(() => {
        const changed = dirty();
        el.classList.toggle('ohne-button-accent', changed);
        el.classList.toggle('ohne-button-outline', !changed);
      });
    }
    return el;
  };

  const deleteButton = (): HTMLElement =>
    iconButton(
      'trash-x',
      () => t('dashboard.delete'),
      () => void confirmDeleteUploads(untracked(() => view.selection.value)),
      { variant: 'destructive' },
    );

  const clearButton = (): HTMLElement =>
    clearSelectionButton(selectionCount, () => view.clearSelection());

  const selectAllButton = (): HTMLElement =>
    iconButton(
      'select-all',
      () => t('dashboard.selectAll'),
      () => view.selectAll(),
    );

  const selectsAll = (): boolean =>
    view.uploads.value.every((record) => view.isSelected(record.UUID));

  const moveButton = (): HTMLElement =>
    iconButton(
      'file-arrow-right',
      () => t('uploads.dashboard.move'),
      () => options.onMove?.(untracked(() => view.selection.value)),
    );

  const targets = (value: boolean): UploadRecord[] =>
    view.selection.value.filter(
      (record) => (record.private === true) !== value && !pinned(record, view.privateFolders.value),
    );

  const privacyButton = (value: boolean): HTMLElement =>
    iconButton(
      value ? 'lock' : 'lock-open',
      () => t(value ? 'uploads.dashboard.makePrivate' : 'uploads.dashboard.makePublic'),
      () =>
        void setUploadsPrivate(
          untracked(() => targets(value)),
          value,
        ),
    );

  const selects = (locked: boolean): boolean => targets(!locked).length > 0;

  const searchButton = iconButton(
    'search',
    () => t('dashboard.search'),
    () => {
      searchOpen.value = true;
    },
    { dirty: () => keyword() !== '' },
  );

  const filterButton = iconButton(
    'adjustments',
    () => t('dashboard.filter.title'),
    () => {
      filterOpen.value = true;
    },
    { dirty: whereDirty },
  );

  const sortingButton = iconButton(
    'arrows-sort',
    () => t('dashboard.sort.title'),
    () => {
      sortingOpen.value = true;
    },
    { dirty: orderDirty },
  );

  const applyButton =
    mode === 'multiple'
      ? button(() => t('dashboard.applyCount', { count: selectionCount() }), {
          variant: 'primary',
          onClick: () => options.onApply?.(),
        })
      : null;

  const createEl =
    mode === 'none'
      ? when(
          () => !view.hidden.value,
          () =>
            mediaActions({
              compact: () => compact.value,
              onCreateFolder: () => options.onCreateFolder?.(untracked(() => view.directory.value)),
              onUpload: (files) =>
                options.onUpload?.(
                  files,
                  untracked(() => view.directory.value),
                ),
              onUploadURL: (url) =>
                options.onUploadURL?.(
                  url,
                  untracked(() => view.directory.value),
                ),
            }),
        )
      : null;

  const searchHost = when(
    () => searchOpen.value,
    () => {
      const input = ref(untracked(keyword));
      const search = (): void => {
        const next = input.value.trim();
        if (next !== untracked(keyword)) view.push({ page: 1, where: searchWhere(next) });
        close();
      };
      const close = (): void => {
        void handle.close().then(() => {
          searchOpen.value = false;
        });
      };
      const closeButton = button(() => t('dashboard.close'), {
        icon: 'x',
        iconOnly: true,
        size: -2,
        variant: 'ghost',
        class: 'ohne-ml-auto',
        onClick: close,
      });
      const handle = popup(
        [
          formField(
            textInput(input, {
              id: 'o-media-search',
              name: 'keyword',
              autofocus: true,
              placeholder: () => t('uploads.dashboard.searchByName'),
            }),
            { label: 'dashboard.search' },
          ),
          h(
            'div',
            { class: 'o-media-footer-search-buttons ohne-row' },
            button(() => t('dashboard.cancel'), { variant: 'outline', onClick: close }),
            button(() => t('dashboard.search'), { onClick: search }),
          ),
        ],
        {
          size: -1,
          width: '26rem',
          fullHeight: 'auto',
          header: h(
            'div',
            { class: 'ohne-row' },
            h('span', { class: 'o-media-footer-search-title' }, () => t('dashboard.search')),
            closeButton,
          ),
          onClose: close,
          onKeydown: (event) => {
            if (event.key === 'Enter' && handle.root.contains(event.target as Node)) search();
          },
        },
      );
      return null;
    },
  );

  const filterHost = when(
    () => filterOpen.value && !isUndefined(collection),
    () => {
      if (isUndefined(collection)) return null;
      let pending: ConditionObject | undefined;
      let apply = false;
      filterPopup({
        title: () => t('dashboard.filter.title'),
        fields: () => readableFields(collection),
        where: untracked(() => view.query.value.where),
        onApply: (where) => {
          pending = where;
          apply = true;
        },
        onClose: (close) =>
          void close().then(() => {
            filterOpen.value = false;
            if (apply) view.push({ page: 1, where: pending });
          }),
      });
      return null;
    },
  );

  const sortingHost = when(
    () => sortingOpen.value && !isUndefined(collection),
    () => {
      if (isUndefined(collection)) return null;
      let pending: string[] = [];
      let apply = false;
      sortingPopup({
        fields: () => sortableFields(collection),
        order: untracked(() => view.query.value.order),
        defaults: DEFAULT_ORDER,
        onApply: (order) => {
          pending = order;
          apply = true;
        },
        onClose: (close) =>
          void close().then(() => {
            sortingOpen.value = false;
            if (apply) view.push({ page: 1, order: pending });
          }),
      });
      return null;
    },
  );

  // Pinned like a hotkey instance, so arrows go dead while a popup sits above the footer's surface.
  let depth = -1;
  void nextTick().then(() => {
    setTimeout(() => {
      depth = overlayCount();
    });
  });

  const onArrowKey = (event: KeyboardEvent): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    if (hasModifierKey(event) || isEditingText() || overlayCount() !== depth) return;
    const { currentPage, lastPage } = view.paginated.value;
    if (event.key === 'ArrowLeft' && currentPage > 1) {
      event.preventDefault();
      view.push({ page: currentPage - 1 });
    } else if (event.key === 'ArrowRight' && currentPage < lastPage) {
      event.preventDefault();
      view.push({ page: currentPage + 1 });
    }
  };
  window.addEventListener('keydown', onArrowKey);
  onCleanup(() => window.removeEventListener('keydown', onArrowKey));

  // On the media page the search hotkey belongs to the dashboard palette.
  if (mode !== 'none') {
    const hotkeys = useHotkeys({ allowInOverlays: true });
    hotkeys.listen('search', (event) => {
      if (overlayCount() !== depth) return;
      event.preventDefault();
      searchOpen.value = true;
    });
  }

  const root = h(
    'div',
    {
      class: () =>
        'o-media-footer ohne-justify-between' +
        (hasSelection() ? ' o-media-footer-has-selection' : ''),
    },
    paginationEl,
    h(
      'div',
      { class: 'ohne-row ohne-ml-auto' },
      when(() => hasSelection() && canDelete, deleteButton),
      when(hasSelection, clearButton),
      when(() => hasSelection() && !selectsAll(), selectAllButton),
      when(() => hasSelection() && canMove && !isUndefined(options.onMove), moveButton),
      when(
        () => hasSelection() && canSetPrivate && selects(false),
        () => privacyButton(true),
      ),
      when(
        () => hasSelection() && canSetPrivate && selects(true),
        () => privacyButton(false),
      ),
      searchButton,
      filterButton,
      sortingButton,
      createEl,
      applyButton,
    ),
    searchHost,
    filterHost,
    sortingHost,
  );
  const observer = new ResizeObserver((entries) => {
    compact.value = (first(entries)?.contentRect.width ?? Infinity) < COMPACT_FOOTER_WIDTH;
  });
  observer.observe(root);
  onCleanup(() => observer.disconnect());
  return root;
}
