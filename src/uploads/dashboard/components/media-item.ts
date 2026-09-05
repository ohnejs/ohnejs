import { attachTooltip, button, checkbox, css, h, icon, when } from 'ohne/dashboard';
import { onCleanup, type Ref, untracked } from 'ohne/utils';

import type { UploadRecord } from '../../uploads/types.ts';

import { dragImage, startMoving, stopMoving } from './_drag-image.ts';
import { useUploadsT } from './_messages.ts';
import { mediaFileItem } from './media-file-item.ts';
import { mediaFileName } from './media-file-name.ts';
import { mediaFolderItem } from './media-folder-item.ts';
import { detailsHref, type MediaItemDisabled, mediaImageItem } from './media-image-item.ts';
import { confirmDeleteUploads, type UploadsPermissions } from './media-library-data.ts';
import {
  isDisplayableImage,
  mediaPath,
  type MediaSelectionMode,
  type MediaView,
} from './media-library-state.ts';

/**
 * The single-record actions a tile offers beyond what it does itself.
 * The library opens, selects, and deletes on its own; these open the popups a record edits through.
 */
export interface MediaItemActions {
  /**
   * Called when a tile asks to rename its record.
   */
  onRename?(record: UploadRecord): void;

  /**
   * Called when a tile asks to move records through the folder picker.
   */
  onMove?(records: readonly UploadRecord[]): void;

  /**
   * Called when a tile asks to open a file's details.
   */
  onDetails?(record: UploadRecord): void;
}

/**
 * Options for `mediaItem`.
 */
export interface MediaItemOptions {
  /**
   * The view the tile belongs to.
   */
  view: MediaView;

  /**
   * The viewer's upload permissions; they gate the checkbox, the delete and rename buttons, and dragging.
   */
  permissions: UploadsPermissions;

  /**
   * How the library selects.
   *
   * @default
   * 'none'
   */
  selectionMode?: MediaSelectionMode;

  /**
   * Whether the tile shows its record's path in a tooltip, read reactively.
   * A filtered grid reaches into subfolders, so the path says where a hit lives.
   */
  showPathTooltip?: () => boolean;

  /**
   * Whether a record's tile is disabled, and why.
   */
  disabled?(record: UploadRecord): MediaItemDisabled;

  /**
   * Called on a plain click of a tile instead of following its link.
   */
  onPick?(record: UploadRecord, event: MouseEvent): void;

  /**
   * The popups a tile's rename button and the context menu open.
   */
  actions?: MediaItemActions;

  /**
   * Called with the tile's record on a right-click, the library's context menu seam.
   */
  onContextMenu?(record: UploadRecord, event: MouseEvent): void;

  /**
   * Whether the range modifier is held, read when the checkbox toggles.
   * Omitted means every toggle is a plain one.
   */
  rangeKey?: () => boolean;
}

const NOT_DISABLED: MediaItemDisabled = { value: false };

css`
  .o-media-item {
    transition: var(--ohne-transition);
    transition-property: opacity;
  }

  .o-media-library-moving .o-media-item-selected {
    opacity: 0.25;
  }

  .o-media-item-box {
    position: relative;
  }

  .o-media-item-checkbox {
    --ohne-card: var(--ohne-background);
    position: absolute;
    bottom: 0.5rem;
    left: 0.5rem;
    opacity: 0;
    visibility: hidden;
    transition: var(--ohne-transition);
  }

  .o-media-item-delete-button {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    opacity: 0;
    visibility: hidden;
    transition: var(--ohne-transition);
  }

  .o-media-item-selected .o-media-item-checkbox,
  .o-media-item-selected .o-media-item-delete-button,
  .o-media-item-box:hover .o-media-item-checkbox,
  .o-media-item-box:hover .o-media-item-delete-button,
  .o-media-item-box:focus-within .o-media-item-checkbox,
  .o-media-item-box:focus-within .o-media-item-delete-button {
    opacity: 1;
    visibility: visible;
  }

  .o-media-item-name {
    display: flex;
    justify-content: center;
    gap: 0.5rem;
    align-items: center;
    height: 1.5rem;
    margin-top: 0.25rem;
    padding: 0 0.75rem;
    font-size: 0.875rem;
  }

  .o-media-item-name-text {
    display: flex;
    min-width: 0;
    text-decoration: none;
  }

  .o-media-item-rename-button {
    display: none;
  }

  .o-media-item-name:hover .o-media-item-rename-button {
    display: inline-flex;
  }

  @media (max-width: 767px) {
    .o-media-item-checkbox {
      bottom: 0.375rem;
      left: 0.375rem;
    }

    .o-media-item-delete-button {
      top: 0.375rem;
      right: 0.375rem;
    }
  }
`;

/**
 * One grid tile: the kind's square, the hover checkbox and delete button over it, and the name row under it.
 * A folder tile links into the folder; an image or file tile links to the record's details.
 * With update permission the tile drags.
 * The drag selects it, shows the moving ghost, and arms the drop targets.
 * The checkbox toggles the selection, ranging from the last pick while the range modifier is held.
 * A right-click hands the record to `onContextMenu`.
 */
export function mediaItem(record: () => UploadRecord, options: MediaItemOptions): HTMLElement {
  const t = useUploadsT();
  const view = options.view;
  const mode = options.selectionMode ?? 'none';
  const { canUpdate, canDelete } = options.permissions;
  const kind = untracked(record).kind;
  const disabled = (): MediaItemDisabled => options.disabled?.(record()) ?? NOT_DISABLED;
  const selected = (): boolean => view.isSelected(record().UUID);
  const selectable =
    mode !== 'single' && (mode !== 'multiple' || kind === 'file') && (canUpdate || canDelete);
  const draggable = canUpdate && mode === 'none';

  const selectedModel: Ref<boolean> = {
    get value() {
      return selected();
    },
    set value(next) {
      const range = options.rangeKey?.() ?? false;
      if (next) view.select(record(), range);
      else view.deselect(record(), range);
    },
  };

  const tile =
    kind === 'folder'
      ? mediaFolderItem(record, {
          view,
          allowDrop: mode !== 'multiple',
          onPick: options.onPick,
        })
      : (isDisplayableImage(untracked(record)) ? mediaImageItem : mediaFileItem)(record, {
          view,
          selectionMode: mode,
          disabled,
          onPick: options.onPick,
        });

  const checkboxEl = (): HTMLElement => {
    const el = checkbox(selectedModel);
    el.classList.add('o-media-item-checkbox');
    if (mode !== 'multiple') {
      onCleanup(attachTooltip(el, () => t(selected() ? 'dashboard.deselect' : 'dashboard.select')));
    }
    return el;
  };

  const deleteButton = (): HTMLElement => {
    const el = button(icon('trash-x'), {
      size: -3,
      variant: 'destructive',
      class: 'o-media-item-delete-button',
      onClick: () => void confirmDeleteUploads([record()]),
    });
    onCleanup(attachTooltip(el, () => t('dashboard.delete')));
    return el;
  };

  const renameButton = (): HTMLElement => {
    const el = button(icon('pencil'), {
      size: -3,
      variant: 'outline',
      class: 'o-media-item-rename-button',
      onClick: (event) => {
        event.stopPropagation();
        options.actions?.onRename?.(record());
      },
    });
    onCleanup(attachTooltip(el, () => t('uploads.dashboard.rename')));
    return el;
  };

  const nameText =
    kind === 'folder'
      ? h('span', { class: 'ohne-truncate' }, () => record().name)
      : mediaFileName(() => record().name);

  const name =
    mode === 'none'
      ? h('span', { title: () => record().name, class: 'o-media-item-name-text' }, nameText)
      : h(
          'a',
          {
            href: () =>
              kind === 'folder' ? mediaPath(record().path) : detailsHref(record(), true),
            target: '_blank',
            title: () => record().name,
            class: 'o-media-item-name-text',
          },
          nameText,
        );

  const root = h(
    'div',
    { class: () => 'o-media-item' + (selected() ? ' o-media-item-selected' : '') },
    h(
      'div',
      {
        draggable: draggable ? 'true' : undefined,
        class: 'o-media-item-box',
        onDragstart: (event: DragEvent) => {
          if (!draggable) {
            event.preventDefault();
            return;
          }
          const current = record();
          if (!view.isSelected(current.UUID)) view.select(current);
          startMoving(
            view,
            t('uploads.dashboard.selected', {
              count: untracked(() => view.selection.value.length),
            }),
          );
          // Firefox starts a drag only once the transfer carries data.
          event.dataTransfer?.setData('text/plain', current.path);
          event.dataTransfer?.setDragImage(dragImage(), -16, 10);
        },
        onDragend: () => stopMoving(view),
        onContextmenu: (event: MouseEvent) => options.onContextMenu?.(record(), event),
      },
      tile,
      when(() => selectable && !disabled().value, checkboxEl),
      when(
        () =>
          mode === 'none' && canDelete && view.selection.value.length === 0 && !disabled().value,
        deleteButton,
      ),
    ),
    h(
      'div',
      { class: 'o-media-item-name' },
      name,
      mode === 'none' && canUpdate ? renameButton() : null,
    ),
  );

  if (options.showPathTooltip) {
    const show = options.showPathTooltip;
    onCleanup(
      attachTooltip(root, () => (show() ? record().path : null), {
        placement: 'bottom',
        offset: 4,
      }),
    );
  }

  return root;
}
