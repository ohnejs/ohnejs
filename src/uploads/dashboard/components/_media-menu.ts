import { type MenuAction, type MenuGroup, navigate } from 'ohnejs/dashboard';

import type { UploadRecord } from '../../uploads/types.ts';
import type { UploadsPermissions } from './_permissions.ts';
import type { MediaItemActions } from './media-item.ts';

import { detailsHref } from './media-image-item.ts';
import { confirmDeleteUploads, resolveUploadURL, setUploadsPrivate } from './media-library-data.ts';
import { mediaPath, type MediaView, pinned } from './media-library-state.ts';

/**
 * Options for `mediaMenu`.
 */
export interface MediaMenuOptions {
  /**
   * The view whose selection the menu acts on.
   */
  view: MediaView;

  /**
   * The viewer's upload permissions; they gate the rows.
   */
  permissions: UploadsPermissions;

  /**
   * The popups the rename, move, and details rows open.
   */
  actions: MediaItemActions;

  /**
   * Whether a record may join the selection, which decides if its menu offers to select it.
   */
  selectable(record: UploadRecord): boolean;
}

/**
 * The context menu groups for `record`: the whole selection when `record` is in it, else `record` alone.
 * Opening the menu never changes the selection.
 * The item group leads with what a click does, Open for a folder and Details for a file, then its edits.
 * The go rows and rename show only while the menu acts on one record.
 * Move and delete take every record; make private and make public take those they change.
 * The selection row comes next, and delete closes the menu in a group of its own.
 * Only on the selection does the delete row label the Delete hotkey, which deletes that same selection.
 */
export function mediaMenu(record: UploadRecord, options: MediaMenuOptions): MenuGroup[] {
  const { view, actions } = options;
  const { canEdit, canMove, canSetPrivate, canDelete } = options.permissions;
  const inSelection = view.isSelected(record.UUID);
  const records = inSelection ? view.selection.value : [record];
  const alone = records.length === 1;
  const folder = record.kind === 'folder';
  const privacy = [true, false].map((value): MenuAction | false => {
    const changed = records.filter(
      (entry) => (entry.private === true) !== value && !pinned(entry, view.privateFolders.value),
    );
    return (
      canSetPrivate &&
      changed.length > 0 && {
        label: value ? 'uploads.dashboard.makePrivate' : 'uploads.dashboard.makePublic',
        icon: value ? 'lock' : 'lock-open',
        onSelect: () => void setUploadsPrivate(changed, value),
      }
    );
  });
  return [
    [
      alone &&
        (folder
          ? { label: 'dashboard.open', icon: 'folder-open', href: mediaPath(record.path) }
          : {
              label: 'uploads.dashboard.details',
              icon: 'info-circle',
              onSelect: () => {
                if (actions.onDetails) actions.onDetails(record);
                else navigate(detailsHref(record, false));
              },
            }),
      alone && {
        label: 'dashboard.openInNewTab',
        icon: 'external-link',
        href: folder ? mediaPath(record.path) : resolveUploadURL(record),
        target: '_blank',
      },
      alone &&
        canEdit &&
        actions.onRename && {
          label: 'uploads.dashboard.rename',
          icon: 'cursor-text',
          onSelect: () => actions.onRename?.(record),
        },
      canMove &&
        actions.onMove && {
          label: 'uploads.dashboard.move',
          icon: 'file-arrow-right',
          onSelect: () => actions.onMove?.(records),
        },
      ...privacy,
    ],
    [
      inSelection
        ? alone
          ? {
              label: 'dashboard.deselect',
              icon: 'square-off',
              onSelect: () => view.deselect(record),
            }
          : {
              label: 'dashboard.clearSelection',
              icon: 'square-off',
              onSelect: () => view.clearSelection(),
            }
        : options.selectable(record) && {
            label: 'dashboard.select',
            icon: 'checkbox',
            onSelect: () => view.select(record),
          },
    ],
    [
      canDelete && {
        label: alone
          ? 'dashboard.delete'
          : { key: 'uploads.dashboard.deleteCount', params: { count: records.length } },
        icon: 'trash-x',
        hotkey: inSelection ? 'delete' : undefined,
        destructive: true,
        onSelect: () => void confirmDeleteUploads(records),
      },
    ],
  ];
}
