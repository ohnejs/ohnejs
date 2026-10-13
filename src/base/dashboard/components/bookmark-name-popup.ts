import {
  type ActionForm,
  button,
  css,
  formField,
  h,
  popup,
  type Popup,
  type PopupClose,
  type Resource,
  textInput,
  toast,
  useAction,
  useHotkeys,
  useT,
} from 'ohnejs/dashboard';
import { first, ref } from 'ohnejs/utils';

import type { BookmarkEntry } from '../../bookmarks/types.ts';

/**
 * Options for `bookmarkNamePopup`.
 */
export interface BookmarkNamePopupOptions {
  /**
   * The URL segment of the collection whose table the bookmark belongs to.
   */
  segment: string;

  /**
   * What the popup saves: `view` as a new bookmark, or a new name for `bookmark`.
   */
  target: { view: string } | { bookmark: BookmarkEntry };

  /**
   * The bookmarks list, reloaded once the save lands.
   */
  list: Resource<unknown>;

  /**
   * Called when the popup asks to close, with its animated close function.
   * The caller awaits it and then disposes the region that created the popup.
   */
  onClose(close: PopupClose): void;
}

css`
  .o-bookmark-name-buttons {
    justify-content: flex-end;
    margin-top: 0.75rem;
  }
`;

/**
 * The popup that names a new bookmark or renames one: one name input over Cancel and Create or Rename.
 * The name is sent trimmed; the submit stays disabled while it is empty, or unchanged on a rename.
 * A save toasts, reloads the bookmarks list, and closes.
 * A `422` shows the name's message under the input, and toasts any other.
 * Enter in the input and Cmd/Ctrl+S submit.
 * Create it inside a reactive region; dispose the region after `onClose`'s close resolves.
 */
export function bookmarkNamePopup(options: BookmarkNamePopupOptions): Popup {
  const t = useT();
  const { target } = options;
  const renamed = 'bookmark' in target ? target.bookmark : undefined;
  const name = ref(renamed?.name ?? '');
  const error = ref('');
  const busy = ref(false);
  const trimmed = (): string => name.value.trim();
  const disabled = (): boolean => busy.value || trimmed() === '' || trimmed() === renamed?.name;

  const control = textInput(name, {
    id: 'o-bookmark-name',
    name: 'name',
    autofocus: true,
    placeholder: () => t('dashboard.bookmarks.namePlaceholder'),
  });

  const fields = (): Record<string, string> =>
    'view' in target ? { name: trimmed(), view: target.view } : { name: trimmed() };

  const form: ActionForm = {
    read: () => ({ value: fields() }),
    readPatch: () => ({ value: fields() }),
    setErrors: ({ name: message = '', ...rest }) => {
      error.value = message;
      if (message !== '') control.querySelector('input')?.focus();
      return first(Object.values(rest)) ?? '';
    },
    rebase: () => {},
    setBusy: (next) => {
      busy.value = next;
    },
  };

  const actionOptions = {
    form,
    reload: [options.list],
    onDone: () => {
      const message = renamed ? 'dashboard.bookmarks.renamed' : 'dashboard.bookmarks.created';
      toast(t(message, { name: trimmed() }), { type: 'success' });
      options.onClose(handle.close);
    },
  };
  const save = renamed
    ? useAction('PATCH /dashboard/bookmarks/[collection]/[uuid]', {
        ...actionOptions,
        params: { collection: options.segment, uuid: renamed.UUID },
      })
    : useAction('POST /dashboard/bookmarks/[collection]', {
        ...actionOptions,
        params: { collection: options.segment },
      });

  const submit = (): void => {
    if (disabled()) return;
    error.value = '';
    void save.run();
  };

  const closeButton = button(() => t('dashboard.close'), {
    icon: 'x',
    iconOnly: true,
    size: -2,
    variant: 'ghost',
    class: 'ohne-ml-auto',
    onClick: () => options.onClose(handle.close),
  });

  const handle = popup(
    [
      formField(control, {
        label: renamed ? 'dashboard.bookmarks.newName' : 'dashboard.bookmarks.name.label',
        error: () => error.value,
        required: true,
      }),
      h(
        'div',
        { class: 'o-bookmark-name-buttons ohne-row' },
        button(() => t('dashboard.cancel'), {
          variant: 'outline',
          onClick: () => options.onClose(handle.close),
        }),
        button(() => t(renamed ? 'dashboard.bookmarks.rename' : 'dashboard.create'), {
          disabled,
          onClick: submit,
        }),
      ),
    ],
    {
      size: -1,
      width: '26rem',
      header: h(
        'div',
        { class: 'ohne-row' },
        h('span', null, () =>
          t(renamed ? 'dashboard.bookmarks.renameBookmark' : 'dashboard.bookmarks.newBookmark'),
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
