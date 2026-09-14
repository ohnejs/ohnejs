import { attachTooltip, button, type ButtonOptions, h, icon, when } from 'ohnejs/dashboard';
import { onCleanup } from 'ohnejs/utils';

import { useUploadsT } from './_messages.ts';
import { uploadsPermissions } from './media-library-data.ts';

/**
 * Options for `mediaActions`.
 */
export interface MediaActionsOptions {
  /**
   * Called when the New folder button asks for a folder; the caller opens the create-folder popup.
   */
  onCreateFolder?(): void;

  /**
   * Called with the files a viewer picked through the Upload button; the caller queues the uploads.
   */
  onUpload?(files: File[]): void;

  /**
   * Whether the footer is too narrow for a labeled Upload button.
   * While it returns `true`, Upload renders as an icon button with a tooltip.
   */
  compact?(): boolean;
}

/**
 * The create cluster of the footer: a New folder icon button and a primary Upload button.
 * Upload opens a hidden multiple file input and hands the picked files to `onUpload`.
 * While `compact` reports a narrow footer, Upload shrinks to an icon button with a tooltip.
 * Renders nothing for a viewer without create permission.
 */
export function mediaActions(options: MediaActionsOptions = {}): HTMLElement | null {
  if (!uploadsPermissions().canCreate) return null;
  const t = useUploadsT();

  const input = h('input', {
    hidden: true,
    multiple: true,
    type: 'file',
    onChange: () => {
      const files = [...(input.files ?? [])];
      if (files.length > 0) options.onUpload?.(files);
      input.value = '';
    },
  }) as HTMLInputElement;

  const newFolder = button(icon('folder-plus'), {
    variant: 'outline',
    onClick: (event) => {
      event.stopPropagation();
      options.onCreateFolder?.();
    },
  });
  onCleanup(attachTooltip(newFolder, () => t('uploads.dashboard.newFolder')));

  const uploadOptions: ButtonOptions = {
    variant: 'primary',
    onClick: (event) => {
      event.stopPropagation();
      input.click();
    },
  };
  const upload = when(
    () => options.compact?.() ?? false,
    () => {
      const el = button(icon('upload'), uploadOptions);
      onCleanup(attachTooltip(el, () => t('uploads.dashboard.upload')));
      return el;
    },
    () =>
      button([h('span', null, () => t('uploads.dashboard.upload')), icon('upload')], uploadOptions),
  );

  return h('div', { class: 'ohne-row' }, input, newFolder, upload);
}
