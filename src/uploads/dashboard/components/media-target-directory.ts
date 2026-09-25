import { attachTooltip, button, type Child, css, h, icon, when } from 'ohnejs/dashboard';
import { onCleanup, ref } from 'ohnejs/utils';

import type { UploadRecord } from '../../uploads/types.ts';
import type { TargetDirectory } from './_target-tree.ts';

import { useUploadsT } from './_messages.ts';
import { createFolderPopup } from './create-folder-popup.ts';
import { uploadsPermissions } from './media-library-data.ts';

/**
 * Options for `mediaTargetDirectory`.
 */
export interface MediaTargetDirectoryOptions {
  /**
   * The node's depth; every level but the first indents.
   *
   * @default
   * 0
   */
  level?: number;

  /**
   * Called with the folder a viewer picks as the destination.
   */
  onSelect(directory: TargetDirectory): void;

  /**
   * Called with a subfolder created inline, so the owner reloads the tree.
   */
  onCreated?(record: UploadRecord): void;
}

css`
  .o-media-target-directory:not(.o-media-target-directory-0) {
    padding-left: 0.75rem;
  }

  .o-media-target-directory:not(:first-child) {
    margin-top: 0.5rem;
  }

  .o-media-target-directory-buttons {
    display: flex;
    gap: 0.5rem;
  }

  .o-media-target-directory-target-button {
    flex-grow: 1;
    justify-content: flex-start;
  }

  .o-media-target-directory-subdirectory-button {
    display: none;
  }

  .o-media-target-directory-buttons:hover .o-media-target-directory-subdirectory-button,
  .o-media-target-directory-buttons:focus-within .o-media-target-directory-subdirectory-button {
    display: inline-flex;
  }

  .o-media-target-directory-children {
    margin-top: 0.5rem;
  }
`;

/**
 * One node of the move target tree, its children nested beneath it.
 * The wide outline button picks the folder and stays disabled where the selection may not land.
 * The New subfolder button beside it appears on hover and opens the create-folder popup for this folder.
 * It shows only while the viewer's permissions grant creating folders.
 */
export function mediaTargetDirectory(
  directory: TargetDirectory,
  options: MediaTargetDirectoryOptions,
): HTMLElement {
  const t = useUploadsT();
  const level = options.level ?? 0;

  const target = button(directory.name, {
    variant: 'outline',
    disabled: () => directory.disabled,
    class: 'o-media-target-directory-target-button',
    onClick: () => options.onSelect(directory),
  });
  onCleanup(
    attachTooltip(target, () =>
      t('uploads.dashboard.moveInto', {
        directory: directory.path === '' ? '/' : directory.path,
      }),
    ),
  );

  return h(
    'div',
    { class: `o-media-target-directory o-media-target-directory-${level}` },
    h(
      'div',
      { class: 'o-media-target-directory-buttons' },
      target,
      uploadsPermissions().canCreateFolder ? newSubfolder(directory, options) : null,
    ),
    directory.children.length > 0
      ? h(
          'div',
          { class: 'o-media-target-directory-children' },
          directory.children.map((child) =>
            mediaTargetDirectory(child, { ...options, level: level + 1 }),
          ),
        )
      : null,
  );
}

/**
 * The New subfolder icon button, and the region its create-folder popup renders in while open.
 */
function newSubfolder(directory: TargetDirectory, options: MediaTargetDirectoryOptions): Child {
  const t = useUploadsT();
  const open = ref(false);

  const el = button(icon('folder-plus'), {
    variant: 'outline',
    class: 'o-media-target-directory-subdirectory-button',
    onClick: (event) => {
      event.stopPropagation();
      open.value = true;
    },
  });
  onCleanup(attachTooltip(el, () => t('uploads.dashboard.subfolder')));

  const host = when(
    () => open.value,
    () => {
      createFolderPopup({
        directory: directory.path,
        title: () => t('uploads.dashboard.subfolder'),
        onCreated: options.onCreated,
        onClose: (close) =>
          void close().then(() => {
            open.value = false;
          }),
      });
      return null;
    },
  );

  return [el, host];
}
