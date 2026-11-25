import {
  button,
  checkbox,
  type Child,
  formField,
  h,
  icon,
  login,
  loginWithPasskey,
  type LoginOutcome,
  passkeysSupported,
  prose,
  textInput,
  toast,
  useT,
  when,
} from 'ohnejs/dashboard';
import { effect, isNull, isUndefined, ref } from 'ohnejs/utils';

import { authMethods } from './auth-methods.ts';
import { loginDefaults } from './login-defaults.ts';
import { shellSlots } from './shell-slots.ts';

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
 * The sign-in form: email and password, a passkey button, or both, as `GET /auth/methods` answers.
 * An empty field earns its message under the input.
 * Wrong credentials, an unreachable server, and any other refusal each raise a toast, once per attempt.
 * A throttled attempt keeps the form from submitting until the server's `Retry-After` has passed.
 * The password input reveals through its suffix button.
 * Enter submits from any control, the remember-me checkbox included; without passwords it asks for a passkey.
 * A success updates `sessionUser`, so the page hosting the form owns the navigation.
 * The fields start from `loginDefaults`.
 * The `loginFields` shell slot renders above the submit button, and the `login` slot after `footer`.
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

  effect(() => {
    const defaults = loginDefaults();
    if (isNull(defaults)) return;
    if (!isUndefined(defaults.email)) email.value = defaults.email;
    if (!isUndefined(defaults.password)) password.value = defaults.password;
  });

  const settle = (outcome: LoginOutcome): void => {
    if (outcome.kind === 'throttled') {
      const seconds = outcome.retryAfter;
      toast(t('dashboard.login.throttled', { seconds }), { type: 'error' });
      setTimeout(() => (busy.value = false), seconds * 1000);
      return;
    }
    busy.value = false;
    if (outcome.kind === 'unreachable') toast(t('dashboard.login.unreachable'), { type: 'error' });
    if (outcome.kind === 'failed') toast(t('dashboard.login.failed'), { type: 'error' });
  };

  const submit = async (): Promise<void> => {
    if (busy.value) return;
    emailError.value = email.value === '';
    passwordError.value = password.value === '';
    if (emailError.value || passwordError.value) return;
    busy.value = true;
    const outcome = await login(email.value, password.value, remember.value);
    if (outcome.kind === 'invalid') toast(t('auth.invalidCredentials'), { type: 'error' });
    settle(outcome);
  };

  const signInWithPasskey = async (): Promise<void> => {
    if (busy.value || !passkeysSupported()) return;
    busy.value = true;
    const outcome = await loginWithPasskey(remember.value);
    if (outcome.kind === 'invalid') toast(t('auth.invalidPasskey'), { type: 'error' });
    settle(outcome);
  };

  const primary = (): Promise<void> =>
    authMethods()?.password === false ? signInWithPasskey() : submit();

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
  // The password input keeps focus, so a phone keyboard stays up.
  reveal.addEventListener('mousedown', (event) => event.preventDefault());
  // `button` takes a static variant, so the accent state patches the class list instead.
  effect(() => {
    reveal.classList.toggle('ohne-button-accent', revealed.value);
    reveal.classList.toggle('ohne-button-ghost', !revealed.value);
    reveal.title = t(
      revealed.value ? 'dashboard.login.hidePassword' : 'dashboard.login.showPassword',
    );
    reveal.setAttribute('aria-label', reveal.title);
    reveal.setAttribute('aria-pressed', String(revealed.value));
  });

  const rememberRow = checkbox(remember, () => t('dashboard.login.rememberMe'));
  rememberRow.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void primary();
  });

  return h(
    'form',
    {
      onSubmit: (event: SubmitEvent) => {
        event.preventDefault();
        void primary();
      },
    },
    options.header,
    when(
      () => authMethods()?.password !== false,
      () => [
        formField(
          textInput(email, {
            autocomplete: 'email',
            // A browser refuses autofocus in a cross-origin frame and logs the refusal.
            autofocus: window.self === window.top,
            id: 'email',
            name: 'email',
          }),
          {
            label: 'dashboard.login.email',
            error: () => (emailError.value ? t('validation.required') : ''),
          },
        ),
        formField(
          textInput(password, {
            type: () => (revealed.value ? 'text' : 'password'),
            autocomplete: 'current-password',
            id: 'password',
            name: 'password',
            suffix: reveal,
          }),
          {
            label: 'dashboard.login.password',
            error: () => (passwordError.value ? t('validation.required') : ''),
          },
        ),
      ],
    ),
    formField(rememberRow),
    ...shellSlots('loginFields').map((render) => render()),
    when(
      () => authMethods()?.password !== false,
      () =>
        formField(
          button(() => t('dashboard.login.submit'), { type: 'submit', class: 'ohne-w-full' }),
        ),
    ),
    when(
      () => authMethods()?.password === false && !passkeysSupported(),
      () =>
        formField(
          prose(h('p', { class: 'ohne-muted' }, () => t('dashboard.passkeys.unsupported'))),
        ),
    ),
    when(
      () => authMethods()?.passkeys === true && passkeysSupported(),
      () =>
        formField(
          button(() => t('dashboard.login.passkey'), {
            icon: 'fingerprint',
            variant: authMethods()?.password === false ? 'primary' : 'outline',
            class: 'ohne-w-full',
            onClick: () => void signInWithPasskey(),
          }),
        ),
    ),
    options.footer,
    ...shellSlots('login').map((render) => render()),
  );
}
