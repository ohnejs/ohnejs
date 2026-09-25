import {
  attachTooltip,
  button,
  type ButtonOptions,
  type Child,
  h,
  icon,
  when,
} from 'ohnejs/dashboard';
import { onCleanup, ref } from 'ohnejs/utils';

import { useUploadsT } from './_messages.ts';
import { uploadsPermissions } from './media-library-data.ts';
import { urlUploadPopup } from './url-upload-popup.ts';

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
   * Called with the URL a viewer entered in the upload-from-URL popup; the caller queues the upload.
   */
  onUploadURL?(url: string): void;

  /**
   * Whether the footer is too narrow for a labeled Upload button.
   * While it returns `true`, Upload renders as an icon button with a tooltip.
   */
  compact?(): boolean;
}

/**
 * The create cluster of the footer: a New folder icon button, an upload-from-URL icon button, and Upload.
 * Upload opens a hidden multiple file input and hands the picked files to `onUpload`.
 * The URL button opens a popup that hands the entered URL to `onUploadURL`.
 * Each button shows only while the viewer's permissions grant its action.
 * While `compact` reports a narrow footer, Upload shrinks to an icon button with a tooltip.
 * Renders nothing for a viewer granted none of them.
 */
export function mediaActions(options: MediaActionsOptions = {}): HTMLElement | null {
  const { canUpload, canFetch, canCreateFolder } = uploadsPermissions();
  if (!canUpload && !canFetch && !canCreateFolder) return null;
  return h(
    'div',
    { class: 'ohne-row' },
    canCreateFolder ? newFolder(options) : null,
    canFetch ? uploadFromURL(options) : null,
    canUpload ? upload(options) : null,
  );
}

/**
 * The New folder icon button.
 */
function newFolder(options: MediaActionsOptions): HTMLElement {
  const t = useUploadsT();
  const el = button(icon('folder-plus'), {
    variant: 'outline',
    onClick: (event) => {
      event.stopPropagation();
      options.onCreateFolder?.();
    },
  });
  onCleanup(attachTooltip(el, () => t('uploads.dashboard.newFolder')));
  return el;
}

/**
 * The Upload button, and the hidden file input it opens.
 */
function upload(options: MediaActionsOptions): Child {
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

  const uploadOptions: ButtonOptions = {
    variant: 'primary',
    onClick: (event) => {
      event.stopPropagation();
      input.click();
    },
  };
  const el = when(
    () => options.compact?.() ?? false,
    () => {
      const compact = button(icon('upload'), uploadOptions);
      onCleanup(attachTooltip(compact, () => t('uploads.dashboard.upload')));
      return compact;
    },
    () =>
      button([h('span', null, () => t('uploads.dashboard.upload')), icon('upload')], uploadOptions),
  );

  return [input, el];
}

/**
 * The upload-from-URL icon button, and the region its popup renders in while open.
 */
function uploadFromURL(options: MediaActionsOptions): Child {
  const t = useUploadsT();
  const open = ref(false);

  const el = button(icon('link'), {
    variant: 'outline',
    onClick: (event) => {
      event.stopPropagation();
      open.value = true;
    },
  });
  onCleanup(attachTooltip(el, () => t('uploads.dashboard.uploadFromURL')));

  const host = when(
    () => open.value,
    () => {
      urlUploadPopup({
        onSubmit: (url) => options.onUploadURL?.(url),
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
