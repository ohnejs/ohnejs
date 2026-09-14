import { attachTooltip, button, css, h, icon, when } from 'ohnejs/dashboard';
import { onCleanup, ref } from 'ohnejs/utils';

import type { UploadRecord } from '../../uploads/types.ts';
import type { TargetDirectory } from './_target-tree.ts';

import { useUploadsT } from './_messages.ts';
import { createFolderPopup } from './create-folder-popup.ts';

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
 */
export function mediaTargetDirectory(
  directory: TargetDirectory,
  options: MediaTargetDirectoryOptions,
): HTMLElement {
  const t = useUploadsT();
  const level = options.level ?? 0;
  const createOpen = ref(false);

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

  const subfolder = button(icon('folder-plus'), {
    variant: 'outline',
    class: 'o-media-target-directory-subdirectory-button',
    onClick: (event) => {
      event.stopPropagation();
      createOpen.value = true;
    },
  });
  onCleanup(attachTooltip(subfolder, () => t('uploads.dashboard.subfolder')));

  return h(
    'div',
    { class: `o-media-target-directory o-media-target-directory-${level}` },
    h('div', { class: 'o-media-target-directory-buttons' }, target, subfolder),
    directory.children.length > 0
      ? h(
          'div',
          { class: 'o-media-target-directory-children' },
          directory.children.map((child) =>
            mediaTargetDirectory(child, { ...options, level: level + 1 }),
          ),
        )
      : null,
    when(
      () => createOpen.value,
      () => {
        createFolderPopup({
          directory: directory.path,
          title: () => t('uploads.dashboard.subfolder'),
          onCreated: options.onCreated,
          onClose: (close) =>
            void close().then(() => {
              createOpen.value = false;
            }),
        });
        return null;
      },
    ),
  );
}
