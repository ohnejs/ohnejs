import {
  button,
  css,
  formField,
  h,
  popup,
  type Popup,
  type PopupClose,
  textInput,
  type UpdateOutcome,
  useHotkeys,
  useT,
} from 'ohnejs/dashboard';
import { isEmpty, isUndefined, ref } from 'ohnejs/utils';

/**
 * Options for `currentPasswordPopup`.
 */
export interface CurrentPasswordPopupOptions {
  /**
   * Sends the password change with the typed current password, and answers how it went.
   */
  submit(currentPassword: string): Promise<UpdateOutcome>;

  /**
   * Called when the popup asks to close, with its animated close function.
   * It carries the outcome of the change once one was sent, and none on cancel.
   * The caller awaits the close and then disposes the region that created the popup.
   */
  onClose(close: PopupClose, outcome?: UpdateOutcome): void;
}

css`
  .o-current-password-buttons {
    justify-content: flex-end;
    margin-top: 0.75rem;
  }
`;

/**
 * The popup that asks for the current password before a new one saves: one input over Cancel and Save.
 * A refused current password shows its message under the input and keeps the popup open.
 * Any other outcome closes it and hands the outcome to `onClose`.
 * Enter in the input and Cmd/Ctrl+S submit.
 * Create it inside a reactive region; dispose the region after `onClose`'s close resolves.
 */
export function currentPasswordPopup(options: CurrentPasswordPopupOptions): Popup {
  const t = useT();
  const password = ref('');
  const error = ref('');
  const busy = ref(false);
  const disabled = (): boolean => busy.value || isEmpty(password.value);

  const control = textInput(password, {
    id: 'o-current-password',
    name: 'currentPassword',
    type: 'password',
    autocomplete: 'current-password',
    autofocus: true,
  });

  const submit = async (): Promise<void> => {
    if (disabled()) return;
    error.value = '';
    busy.value = true;
    const outcome = await options.submit(password.value);
    busy.value = false;
    const refused = outcome.kind === 'invalid' ? outcome.errors.currentPassword : undefined;
    if (isUndefined(refused)) {
      options.onClose(handle.close, outcome);
      return;
    }
    error.value = refused;
    control.querySelector('input')?.focus();
  };

  const handle = popup(
    [
      formField(control, {
        label: 'dashboard.account.currentPassword',
        error: () => error.value,
        required: true,
      }),
      h(
        'div',
        { class: 'o-current-password-buttons ohne-row' },
        button(() => t('dashboard.cancel'), {
          variant: 'outline',
          onClick: () => options.onClose(handle.close),
        }),
        button(() => t('dashboard.save'), { disabled, onClick: () => void submit() }),
      ),
    ],
    {
      size: -1,
      width: '26rem',
      title: 'dashboard.account.changePassword',
      onClose: (close) => options.onClose(close),
      onKeydown: (event) => {
        if (
          event.key === 'Enter' &&
          event.target instanceof HTMLInputElement &&
          handle.root.contains(event.target)
        ) {
          void submit();
        }
      },
    },
  );

  const hotkeys = useHotkeys({ allowInOverlays: true, target: () => handle.root, listen: false });
  setTimeout(() => {
    hotkeys.isListening.value = true;
    hotkeys.listen('save', (event) => {
      event.preventDefault();
      void submit();
    });
  });

  return handle;
}
