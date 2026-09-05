import {
  api,
  button,
  css,
  field,
  fieldLabel,
  fieldMessage,
  h,
  icon,
  popup,
  type Popup,
  type PopupClose,
  renderProse,
  textInput,
  toast,
  useHotkeys,
} from 'ohne/dashboard';
import { effect, ref } from 'ohne/utils';

import type { UploadRecord } from '../../uploads/types.ts';

import { useUploadsT } from './_messages.ts';
import { storedFileName, storedFolderName } from './_names.ts';
import { readWireError } from './_wire-error.ts';
import { refreshMedia } from './media-library-data.ts';
import { splitFileName } from './media-library-state.ts';

/**
 * Options for `renamePopup`.
 */
export interface RenamePopupOptions {
  /**
   * Called with the renamed record once the server has answered.
   */
  onRenamed?(record: UploadRecord): void;

  /**
   * Called when the popup asks to close, with its animated close function.
   * The caller awaits it and then disposes the region that created the popup.
   */
  onClose(close: PopupClose): void;
}

const INPUT_ID = 'o-media-rename-name';

css`
  .o-media-rename-buttons {
    justify-content: flex-end;
    margin-top: 0.75rem;
  }
`;

/**
 * The rename popup: the stem in an input, a file's extension muted after it and kept.
 * A live preview shows the slug the server will store; Rename stays disabled while nothing changes.
 * Rename patches the name, toasts the change, refreshes every open library, and closes.
 * A `422` shows its message under the input; Enter in the input and Cmd/Ctrl+S submit.
 * Create it inside a reactive region; dispose the region after `onClose`'s close resolves.
 */
export function renamePopup(record: UploadRecord, options: RenamePopupOptions): Popup {
  const t = useUploadsT();
  const folder = record.kind === 'folder';
  const { stem, extension } = folder
    ? { stem: record.name, extension: '' }
    : splitFileName(record.name);
  const input = ref(stem);
  const error = ref('');
  const busy = ref(false);
  const stored = (): string =>
    folder ? storedFolderName(input.value) : storedFileName(input.value, extension);
  const typed = (): string => (extension === '' ? input.value : `${input.value}.${extension}`);
  const disabled = (): boolean => busy.value || stored() === '' || stored() === record.name;

  const rename = async (): Promise<void> => {
    if (disabled()) return;
    busy.value = true;
    try {
      const response = await api(`PATCH /uploads/${record.UUID}`, {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: stored() }),
      });
      if (response.ok) {
        const renamed = (await response.json()) as UploadRecord;
        toast(t('uploads.dashboard.renamed', { from: record.name, to: renamed.name }), {
          type: 'success',
        });
        refreshMedia();
        options.onRenamed?.(renamed);
        options.onClose(handle.close);
      } else if (response.status === 422) {
        error.value = (await readWireError(response)).message;
      } else {
        toast(t('uploads.dashboard.renameFailed'), { type: 'error' });
      }
    } catch {
      toast(t('dashboard.unreachable'), { type: 'error' });
    } finally {
      busy.value = false;
    }
  };

  const message = h('div', { class: 'ohne-prose' });
  effect(() => {
    const next = stored();
    const text =
      error.value !== ''
        ? error.value
        : next === '' || typed() === next
          ? t(folder ? 'uploads.dashboard.folderNameHint' : 'uploads.dashboard.fileNameHint')
          : `-> \`${next}\``;
    renderProse(message, text);
  });

  const closeButton = button(icon('x'), {
    size: -2,
    variant: 'ghost',
    class: 'ohne-ml-auto',
    onClick: () => options.onClose(handle.close),
  });
  effect(() => {
    closeButton.title = t('dashboard.close');
  });

  const handle = popup(
    [
      field([
        fieldLabel(
          h('label', { for: INPUT_ID }, () =>
            t(folder ? 'uploads.dashboard.folderName' : 'uploads.dashboard.fileName'),
          ),
          { required: true },
        ),
        textInput(input, {
          id: INPUT_ID,
          name: 'name',
          autofocus: true,
          placeholder: () =>
            t(
              folder
                ? 'uploads.dashboard.folderNamePlaceholder'
                : 'uploads.dashboard.fileNamePlaceholder',
            ),
          suffix:
            extension === '' ? undefined : h('span', { class: 'ohne-muted' }, `.${extension}`),
        }),
        fieldMessage(message, { error: () => error.value !== '' }),
      ]),
      h(
        'div',
        { class: 'o-media-rename-buttons ohne-row' },
        button(() => t('dashboard.cancel'), {
          variant: 'outline',
          onClick: () => options.onClose(handle.close),
        }),
        button(() => t('uploads.dashboard.rename'), { disabled, onClick: () => void rename() }),
      ),
    ],
    {
      size: -1,
      width: '26rem',
      header: h(
        'div',
        { class: 'ohne-row' },
        h('span', null, () =>
          t(folder ? 'uploads.dashboard.renameFolder' : 'uploads.dashboard.renameFile'),
        ),
        closeButton,
      ),
      onClose: (close) => options.onClose(close),
      onKeydown: (event) => {
        if (
          event.key === 'Enter' &&
          event.target instanceof HTMLInputElement &&
          handle.root.contains(event.target)
        ) {
          void rename();
        }
      },
    },
  );

  const hotkeys = useHotkeys({ allowInOverlays: true, target: () => handle.root, listen: false });
  setTimeout(() => {
    hotkeys.isListening.value = true;
    hotkeys.listen('save', (event) => {
      event.preventDefault();
      void rename();
    });
  });

  return handle;
}
