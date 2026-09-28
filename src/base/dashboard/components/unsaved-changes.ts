import {
  button,
  type Child,
  css,
  h,
  isEditingText,
  isMac,
  popup,
  useT,
  when,
} from 'ohnejs/dashboard';
import { isString, onCleanup, ref } from 'ohnejs/utils';

import { unsavedChanges } from './history.ts';

css`
  .o-unsaved-changes-row {
    justify-content: flex-end;
    margin-top: 0.75rem;
  }
`;

/**
 * The unsaved-changes dialog, mounted once by the shell.
 * It installs `unsavedChanges.prompt`: each call opens the dialog.
 * The promise resolves `true` to leave, discarding the edits, or `false` to stay.
 * OK, and a bare Enter while no button holds focus, leave.
 * Cancel, Escape, and the overlay click stay.
 * While the dialog is open, the platform undo and redo strokes are swallowed before any hotkey.
 * Independently, while any registered history is dirty, closing the tab raises the browser's leave prompt.
 */
export function unsavedChangesGuard(): Child {
  const t = useT();
  const visible = ref(false);
  let resolvers: ((leave: boolean) => void)[] = [];

  unsavedChanges.prompt = () => {
    visible.value = true;
    return new Promise<boolean>((resolve) => resolvers.push(resolve));
  };
  onCleanup(() => {
    unsavedChanges.prompt = undefined;
  });

  const settle = (leave: boolean): void => {
    const pending = resolvers;
    resolvers = [];
    for (const resolve of pending) resolve(leave);
  };

  const cancel = (): void => {
    visible.value = false;
    settle(false);
  };

  const leave = (): void => {
    visible.value = false;
    settle(true);
  };

  const onBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (isEditingText() && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    if ([...unsavedChanges.histories].some((history) => history.isDirty.value)) {
      event.preventDefault();
      event.returnValue = '';
    }
  };
  window.addEventListener('beforeunload', onBeforeUnload);
  onCleanup(() => window.removeEventListener('beforeunload', onBeforeUnload));

  // Hotkeys allowed in overlays still fire at the popup's depth, so undo and redo are swallowed here.
  const suppressHistoryKeys = (event: KeyboardEvent): void => {
    const mac = isMac();
    // Chrome's autofill fires keydowns whose `key` is `undefined` despite the type.
    const letter = isString(event.key) ? event.key.toLowerCase() : '';
    if (mac && (!event.metaKey || event.altKey || event.ctrlKey)) return;
    if (!mac && (!event.ctrlKey || event.altKey || event.metaKey)) return;
    if ((letter === 'y' && !event.shiftKey) || (letter === 'z' && (mac || !event.shiftKey))) {
      event.preventDefault();
    }
  };

  return when(
    () => visible.value,
    () => {
      window.addEventListener('keydown', suppressHistoryKeys, { capture: true });
      onCleanup(() =>
        window.removeEventListener('keydown', suppressHistoryKeys, { capture: true }),
      );
      const handle = popup(
        [
          h(
            'div',
            { class: 'ohne-prose' },
            h('p', null, () => t('dashboard.unsavedChanges.body')),
          ),
          h(
            'div',
            { class: 'ohne-row o-unsaved-changes-row' },
            button(() => t('dashboard.cancel'), {
              variant: 'outline',
              onClick: () => void handle.close().then(cancel),
            }),
            button(() => t('dashboard.ok'), {
              variant: 'primary',
              onClick: () => void handle.close().then(leave),
            }),
          ),
        ],
        {
          size: -1,
          width: '26rem',
          onClose: (close) => void close().then(cancel),
          onKeydown: (event) => {
            if (
              event.key === 'Enter' &&
              !(document.activeElement instanceof HTMLButtonElement) &&
              !event.metaKey &&
              !event.altKey &&
              !event.ctrlKey &&
              !event.shiftKey
            ) {
              void handle.close().then(leave);
            }
          },
        },
      );
      return null;
    },
  );
}
