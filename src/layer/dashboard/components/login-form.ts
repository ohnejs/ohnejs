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
} from 'ohnejs/dashboard';
import { effect, ref } from 'ohnejs/utils';

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

  // Reading the failure strings here starts their catalog fetches, so the first toast is translated.
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

  // One persistent button whose icon swaps in place, so a click never unmounts the focused node.
  const reveal = button(
    () => {
      const glyph = icon(revealed.value ? 'eye' : 'eye-off');
      glyph.setAttribute('width', '1.125em');
      glyph.setAttribute('height', '1.125em');
      return glyph;
    },
    {
      variant: 'ghost',
      onClick: () => {
        revealed.value = !revealed.value;
      },
    },
  );
  reveal.tabIndex = -1;
  // `button` takes a static variant, so the accent state patches the class list instead.
  effect(() => {
    reveal.classList.toggle('ohne-button-accent', revealed.value);
    reveal.classList.toggle('ohne-button-ghost', !revealed.value);
    reveal.title = t(
      revealed.value ? 'dashboard.login.hidePassword' : 'dashboard.login.showPassword',
    );
  });

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
