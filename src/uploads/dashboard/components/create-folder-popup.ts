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
import { storedFolderName } from './_names.ts';
import { readWireError } from './_wire-error.ts';
import { refreshMedia } from './media-library-data.ts';

/**
 * Options for `createFolderPopup`.
 */
export interface CreateFolderPopupOptions {
  /**
   * The folder the new one goes into, `''` at the root.
   */
  directory: string;

  /**
   * The popup title, read reactively when given as a getter.
   * Omitted titles the popup "New folder".
   */
  title?: string | (() => string);

  /**
   * Called with the created folder's record once the server has answered.
   */
  onCreated?(record: UploadRecord): void;

  /**
   * Called when the popup asks to close, with its animated close function.
   * The caller awaits it and then disposes the region that created the popup.
   */
  onClose(close: PopupClose): void;
}

const INPUT_ID = 'o-media-create-folder-name';

css`
  .o-media-create-folder-buttons {
    justify-content: flex-end;
    margin-top: 0.75rem;
  }
`;

/**
 * The create-folder popup: one name input with a live preview of the slug the server will store.
 * Create posts the folder, toasts its name, refreshes every open library, and closes.
 * A `422` shows its message under the input; Enter in the input and Cmd/Ctrl+S submit.
 * Create it inside a reactive region; dispose the region after `onClose`'s close resolves.
 */
export function createFolderPopup(options: CreateFolderPopupOptions): Popup {
  const t = useUploadsT();
  const name = ref('');
  const error = ref('');
  const busy = ref(false);
  const stored = (): string => storedFolderName(name.value);
  const disabled = (): boolean => busy.value || stored() === '';

  const create = async (): Promise<void> => {
    if (disabled()) return;
    busy.value = true;
    try {
      const response = await api('POST /uploads/folders', {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ directory: options.directory, name: stored() }),
      });
      if (response.ok) {
        const record = (await response.json()) as UploadRecord;
        toast(t('uploads.dashboard.folderCreated', { name: record.name }), { type: 'success' });
        refreshMedia();
        options.onCreated?.(record);
        options.onClose(handle.close);
      } else if (response.status === 422) {
        error.value = (await readWireError(response)).message;
      } else {
        toast(t('uploads.dashboard.folderCreateFailed'), { type: 'error' });
      }
    } catch {
      toast(t('dashboard.unreachable'), { type: 'error' });
    } finally {
      busy.value = false;
    }
  };

  const message = h('div', { class: 'ohne-prose' });
  effect(() => {
    const slug = stored();
    const text =
      error.value !== ''
        ? error.value
        : slug === '' || name.value === slug
          ? t('uploads.dashboard.folderNameHint')
          : `-> \`${slug}\``;
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
          h('label', { for: INPUT_ID }, () => t('uploads.dashboard.folderName')),
          {
            required: true,
          },
        ),
        textInput(name, {
          id: INPUT_ID,
          name: 'name',
          autofocus: true,
          placeholder: () => t('uploads.dashboard.folderNamePlaceholder'),
        }),
        fieldMessage(message, { error: () => error.value !== '' }),
      ]),
      h(
        'div',
        { class: 'o-media-create-folder-buttons ohne-row' },
        button(() => t('dashboard.cancel'), {
          variant: 'outline',
          onClick: () => options.onClose(handle.close),
        }),
        button(() => t('dashboard.create'), { disabled, onClick: () => void create() }),
      ),
    ],
    {
      size: -1,
      width: '26rem',
      header: h(
        'div',
        { class: 'ohne-row' },
        h(
          'span',
          { class: 'ohne-medium' },
          options.title ?? ((): string => t('uploads.dashboard.newFolder')),
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
          void create();
        }
      },
    },
  );

  const hotkeys = useHotkeys({ allowInOverlays: true, target: () => handle.root, listen: false });
  setTimeout(() => {
    hotkeys.isListening.value = true;
    hotkeys.listen('save', (event) => {
      event.preventDefault();
      void create();
    });
  });

  return handle;
}
