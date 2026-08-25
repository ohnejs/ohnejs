import {
  button,
  checkbox,
  type Child,
  field,
  fieldLabel,
  fieldMessage,
  h,
  icon,
  login,
  textInput,
  toast,
  useT,
  when,
} from 'ohne/dashboard';
import { ref } from 'ohne/utils';

/**
 * Options for `loginForm`.
 */
export interface LoginFormOptions {
  /**
   * Content rendered above the fields, inside the form.
   */
  header?: Child | (() => Child);

  /**
   * Content rendered below the submit action, inside the form.
   */
  footer?: Child | (() => Child);
}

/**
 * The email and password sign-in form.
 * An empty field earns its message under the input.
 * Wrong credentials and an unreachable server each raise a toast, once per attempt.
 * The password input reveals through its suffix button.
 * Enter submits from any control, including the remember-me checkbox.
 * A success updates `sessionUser`, so the page hosting the form owns the navigation.
 */
export function loginForm(options: LoginFormOptions = {}): HTMLElement {
  const t = useT();
  const email = ref('');
  const password = ref('');
  const remember = ref(false);
  const revealed = ref(false);
  const emailError = ref(false);
  const passwordError = ref(false);
  const busy = ref(false);

  // Reading the failure strings at construction starts their catalog fetches, so a first
  // failed attempt toasts translated text instead of freezing the raw key into the toast.
  t('auth.invalidCredentials');
  t('dashboard.login.unreachable');

  const submit = async (): Promise<void> => {
    if (busy.value) return;
    emailError.value = email.value === '';
    passwordError.value = password.value === '';
    if (emailError.value || passwordError.value) return;
    busy.value = true;
    const outcome = await login(email.value, password.value, remember.value);
    busy.value = false;
    if (outcome === 'invalid') toast(t('auth.invalidCredentials'), { type: 'error' });
    else if (outcome === 'unreachable') toast(t('dashboard.login.unreachable'), { type: 'error' });
  };

  const reveal = (): HTMLElement => {
    const glyph = icon(revealed.value ? 'eye' : 'eye-off');
    glyph.setAttribute('width', '1.125em');
    glyph.setAttribute('height', '1.125em');
    const control = button(glyph, {
      variant: revealed.value ? 'accent' : 'ghost',
      onClick: () => {
        revealed.value = !revealed.value;
      },
    });
    control.title = t(
      revealed.value ? 'dashboard.login.hidePassword' : 'dashboard.login.showPassword',
    );
    control.tabIndex = -1;
    return control;
  };

  const rememberRow = checkbox(remember, () => t('dashboard.login.rememberMe'));
  rememberRow.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void submit();
  });

  return h(
    'form',
    {
      onSubmit: (event: SubmitEvent) => {
        event.preventDefault();
        void submit();
      },
    },
    options.header,
    field([
      fieldLabel(h('label', { for: 'email' }, () => t('dashboard.login.email'))),
      textInput(email, {
        autocomplete: 'email',
        autofocus: true,
        id: 'email',
        name: 'email',
        error: () => emailError.value,
      }),
      when(
        () => emailError.value,
        () => fieldMessage(() => t('validation.required'), { error: () => true }),
      ),
    ]),
    field([
      fieldLabel([
        h('label', { for: 'password' }, () => t('dashboard.login.password')),
        h('button', { type: 'button', tabindex: '1' }, () => t('dashboard.login.forgotPassword')),
      ]),
      textInput(password, {
        type: () => (revealed.value ? 'text' : 'password'),
        autocomplete: 'current-password',
        id: 'password',
        name: 'password',
        error: () => passwordError.value,
        suffix: reveal,
      }),
      when(
        () => passwordError.value,
        () => fieldMessage(() => t('validation.required'), { error: () => true }),
      ),
    ]),
    field(rememberRow),
    field(button(() => t('dashboard.login.submit'), { type: 'submit', class: 'ohne-w-full' })),
    options.footer,
  );
}
