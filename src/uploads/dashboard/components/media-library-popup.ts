import {
  button,
  css,
  h,
  hasModifierKey,
  icon,
  isEditingText,
  overlayCount,
  popup,
  type Popup,
  type PopupClose,
  useHotkeys,
  when,
} from 'ohnejs/dashboard';
import { effect, isNullish, isUndefined, nextTick, type Ref, ref, untracked } from 'ohnejs/utils';

import type { UploadRecord } from '../../uploads/types.ts';
import type { MediaItemDisabled } from './media-image-item.ts';

import { mediaRecords } from './_media-records.ts';
import { useUploadsT } from './_messages.ts';
import { mediaBreadcrumbs } from './media-breadcrumbs.ts';
import { mediaFooter } from './media-footer.ts';
import {
  createMediaView,
  DEFAULT_ORDER,
  type MediaQuery,
  type MediaSelectionMode,
} from './media-library-state.ts';
import { mediaLibrary } from './media-library.ts';

/**
 * Where a picker left off: the folder it showed and the query it read with.
 * A control keeps one across opens, so reopening lands where the viewer last browsed.
 */
export interface MediaPickerMemory {
  /**
   * The folder shown, `''` at the root.
   */
  directory: string;

  /**
   * The page, order, and filter the grid read with.
   */
  query: MediaQuery;
}

/**
 * Options for `mediaLibraryPopup`.
 */
export interface MediaLibraryPopupOptions {
  /**
   * The currently linked `UUID`s, seeding the selection in their order.
   */
  values: readonly string[];

  /**
   * Whether the picker selects many files; `false` picks exactly one and closes.
   *
   * @default
   * false
   */
  multiple?: boolean;

  /**
   * Whether a record's tile is greyed out, and why; files a field cannot take pass here.
   * Omitted admits every file.
   */
  disabled?(record: UploadRecord): MediaItemDisabled;

  /**
   * The folder and query to open with, written back as the viewer browses.
   * Omitted opens at the root with the default query and remembers nothing.
   */
  memory?: MediaPickerMemory;

  /**
   * Called with the picked `UUID`s: retained values in their given order, then new picks in pick order.
   * A single pick arrives as a one-entry list.
   */
  onApply(uuids: string[]): void;

  /**
   * Called when the popup asks to close, with its animated close function.
   * The caller awaits it and then disposes the region that created the popup.
   */
  onClose(close: PopupClose): void;
}

const NOT_DISABLED: MediaItemDisabled = { value: false };

css`
  .o-media-library-popup .ohne-popup-content .ohne-container-content {
    height: 100%;
  }

  .o-media-library-popup-body {
    height: 100%;
  }

  .o-media-library-popup .o-media-item-box {
    --ohne-card: var(--ohne-secondary);
    --ohne-card-foreground: var(--ohne-secondary-foreground);
  }
`;

/**
 * A fresh picker memory: the given folder, page one, the default order, no filter.
 */
export function createPickerMemory(directory = ''): MediaPickerMemory {
  return { directory, query: { page: 1, order: [...DEFAULT_ORDER], where: undefined } };
}

/**
 * The media picker: the library's breadcrumbs, grid, and footer inside a popup, for linking uploads.
 *
 * The view state lives in memory and never touches the URL.
 * Folders open in place; breadcrumbs and tiles open the real media page in a new tab on a modified click.
 * Single mode applies a file on click and closes; multiple mode toggles tiles and applies explicitly.
 * Ineligible files grey out with the reason in a tooltip and never enter a range selection.
 * Cmd/Ctrl+S applies or closes, Cmd/Ctrl+A selects the page's eligible files, and arrow keys page.
 * Create it inside a reactive region; dispose the region after `onClose`'s close resolves.
 */
export function mediaLibraryPopup(options: MediaLibraryPopupOptions): Popup {
  const t = useUploadsT();
  const multiple = options.multiple ?? false;
  const mode: MediaSelectionMode = multiple ? 'multiple' : 'single';
  const disabled = options.disabled ?? ((): MediaItemDisabled => NOT_DISABLED);
  const memory = options.memory;
  // The view reads its query on construction; tracked, every push would rebuild the popup.
  const view = untracked(() =>
    createMediaView({
      directory: memory?.directory,
      query: memory?.query,
      selectable: (record) => record.kind === 'file' && !disabled(record).value,
    }),
  );
  if (!isUndefined(memory)) {
    effect(() => {
      memory.directory = view.directory.value;
      memory.query = view.query.value;
    });
  }

  void mediaRecords.load(options.values).then((records) => {
    const seeded = records.filter((record): record is UploadRecord => !isNullish(record));
    const known = new Set(seeded.map((record) => record.UUID));
    const picked = untracked(() => view.selection.value).filter(
      (record) => !known.has(record.UUID),
    );
    view.selection.value = [...seeded, ...picked];
  });

  const go = (directory: string): void => {
    if (untracked(() => view.directory.value) === directory) return;
    view.directory.value = directory;
    view.push({ page: 1 });
  };

  const finish = (uuids?: string[]): void => {
    if (!isUndefined(uuids)) options.onApply(uuids);
    options.onClose(handle.close);
  };

  const applySelection = (): void =>
    finish(untracked(() => view.selection.value).map((record) => record.UUID));

  const onPick = (record: UploadRecord): void => {
    if (record.kind === 'folder') go(record.path);
    else if (!multiple) finish([record.UUID]);
  };

  const closeButton = button(icon('x'), {
    size: -2,
    variant: 'ghost',
    class: 'ohne-ml-auto',
    onClick: () => finish(),
  });
  effect(() => {
    closeButton.title = t('dashboard.close');
  });

  const onArrowKey = (event: KeyboardEvent): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    if (hasModifierKey(event) || isEditingText() || overlayCount() !== depth) return;
    const { currentPage, lastPage } = untracked(() => view.paginated.value);
    if (event.key === 'ArrowLeft' && currentPage > 1) {
      event.preventDefault();
      view.push({ page: currentPage - 1 });
    } else if (event.key === 'ArrowRight' && currentPage < lastPage) {
      event.preventDefault();
      view.push({ page: currentPage + 1 });
    }
  };

  // The grid's hotkeys target the popup root, which exists only once `popup` has returned.
  const ready: Ref<boolean> = ref(false);
  const body = h(
    'div',
    { class: 'o-media-library-popup-body' },
    when(
      () => ready.value,
      () =>
        mediaLibrary({
          view,
          selectionMode: mode,
          disabled,
          onPick,
          hotkeys: { allowInOverlays: true, target: () => handle.root },
        }),
    ),
  );

  const handle = popup(body, {
    size: -1,
    width: '105rem',
    fullHeight: true,
    additionalClasses: ['o-media-library-popup'],
    header: h('div', { class: 'ohne-row' }, mediaBreadcrumbs({ view, onPick: go }), closeButton),
    footer: mediaFooter({ view, selectionMode: mode, onApply: applySelection }),
    onClose: () => finish(),
    onKeydown: onArrowKey,
  });
  ready.value = true;

  // Pinned like a hotkey instance, so arrows go dead while a popup or dropdown sits above.
  let depth = -1;
  void nextTick().then(() => {
    setTimeout(() => {
      depth = overlayCount();
    });
  });

  const hotkeys = useHotkeys({ allowInOverlays: true, target: () => handle.root, listen: false });
  setTimeout(() => {
    hotkeys.isListening.value = true;
    hotkeys.listen('save', (event) => {
      event.preventDefault();
      if (multiple) applySelection();
      else finish();
    });
  });

  return handle;
}
