import {
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
  useHotkeys,
  when,
} from 'ohnejs/dashboard';
import { effect, isFetchableURL, isNull, ref } from 'ohnejs/utils';

import { useUploadsT } from './_messages.ts';

/**
 * Options for `urlUploadPopup`.
 */
export interface URLUploadPopupOptions {
  /**
   * Called with the parsed URL once it passes the check; the caller queues the upload.
   */
  onSubmit(url: string): void;

  /**
   * Called when the popup asks to close, with its animated close function.
   * The caller awaits it and then disposes the region that created the popup.
   */
  onClose(close: PopupClose): void;
}

const INPUT_ID = 'o-media-url-upload-url';

css`
  .o-media-url-upload-buttons {
    justify-content: flex-end;
    margin-top: 0.75rem;
  }
`;

/**
 * The upload-from-URL popup: one URL input.
 * Upload hands a URL that `isFetchableURL` accepts to `onSubmit` and closes at once.
 * Any other value shows the invalid-URL message under the input and keeps the popup open.
 * Enter in the input and Cmd/Ctrl+S submit.
 * Create it inside a reactive region; dispose the region after `onClose`'s close resolves.
 */
export function urlUploadPopup(options: URLUploadPopupOptions): Popup {
  const t = useUploadsT();
  const input = ref('');
  const invalid = ref(false);
  const submitted = ref(false);
  const disabled = (): boolean => submitted.value || input.value.trim() === '';

  const submit = (): void => {
    if (disabled()) return;
    const url = URL.parse(input.value);
    if (isNull(url) || !isFetchableURL(url)) {
      invalid.value = true;
      return;
    }
    submitted.value = true;
    options.onSubmit(url.href);
    options.onClose(handle.close);
  };

  const message = h('div', { class: 'ohne-prose' });
  effect(() => renderProse(message, t('uploads.errors.urlInvalid')));

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
          h('label', { for: INPUT_ID }, () => t('uploads.dashboard.url')),
          { required: true },
        ),
        textInput(input, {
          id: INPUT_ID,
          name: 'url',
          type: 'url',
          autofocus: true,
          placeholder: () => t('uploads.dashboard.urlPlaceholder'),
        }),
        when(
          () => invalid.value,
          () => fieldMessage(message, { error: () => true }),
        ),
      ]),
      h(
        'div',
        { class: 'o-media-url-upload-buttons ohne-row' },
        button(() => t('dashboard.cancel'), {
          variant: 'outline',
          onClick: () => options.onClose(handle.close),
        }),
        button(() => t('uploads.dashboard.upload'), { disabled, onClick: submit }),
      ),
    ],
    {
      size: -1,
      width: '26rem',
      header: h(
        'div',
        { class: 'ohne-row' },
        h('span', { class: 'ohne-medium' }, () => t('uploads.dashboard.uploadFromURL')),
        closeButton,
      ),
      onClose: (close) => options.onClose(close),
      onKeydown: (event) => {
        if (
          event.key === 'Enter' &&
          event.target instanceof HTMLInputElement &&
          handle.root.contains(event.target)
        ) {
          submit();
        }
      },
    },
  );

  const hotkeys = useHotkeys({ allowInOverlays: true, target: () => handle.root, listen: false });
  setTimeout(() => {
    hotkeys.isListening.value = true;
    hotkeys.listen('save', (event) => {
      event.preventDefault();
      submit();
    });
  });

  return handle;
}
