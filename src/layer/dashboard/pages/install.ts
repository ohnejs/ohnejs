import {
  api,
  button,
  card,
  defineDashboardPage,
  field,
  fieldLabel,
  fieldMessage,
  h,
  icon,
  navigate,
  prose,
  sessionUser,
  setDocumentTitle,
  textInput,
  toast,
  useT,
  when,
} from 'ohnejs/dashboard';
import { effect, isNullish, ref } from 'ohnejs/utils';

import { authLayout } from '../components/auth-layout.ts';
import { authLogo } from '../components/logo.ts';

/**
 * The install page: the first-user setup card on the auth layout.
 * A welcome note, email, and password create the primary administrator account.
 * The server signs the new account in; success lands on home through a full document load.
 * An installed system redirects to the login page; a signed-in visitor goes home.
 */
export default defineDashboardPage(() => {
  const t = useT();

  effect(() => setDocumentTitle(t('dashboard.install.title')));

  effect(() => {
    if (!isNullish(sessionUser())) navigate('/');
  });

  void installRequired().then((required) => {
    if (!required) navigate('/login', { replace: true });
  });

  return authLayout(authLogo(), card(installForm()));
});

/**
 * Asks `GET /auth/install` whether the first-user setup is still pending.
 * An error and an unreachable API both read as installed, so the login page stays reachable.
 */
export async function installRequired(): Promise<boolean> {
  try {
    const response = await api('/auth/install');
    if (!response.ok) return false;
    return ((await response.json()) as { required: boolean }).required;
  } catch {
    return false;
  }
}

type InstallOutcome =
  | { kind: 'installed' }
  | { kind: 'invalid'; errors: Record<string, string> }
  | { kind: 'refused' }
  | { kind: 'unreachable' };

/**
 * The first-user form: the welcome note, email, and password over a full-width submit.
 * A `422` routes its per-field messages under the inputs; a `403` yields to the login page.
 * An unreachable server raises a toast.
 */
function installForm(): HTMLElement {
  const t = useT();
  const email = ref('');
  const password = ref('');
  const revealed = ref(false);
  const emailError = ref('');
  const passwordError = ref('');
  const busy = ref(false);

  // This warms the catalog, so a first failed attempt toasts translated text, not the raw key.
  t('dashboard.unreachable');

  const submit = async (): Promise<void> => {
    if (busy.value) return;
    busy.value = true;
    emailError.value = '';
    passwordError.value = '';
    const outcome = await install(email.value, password.value);
    busy.value = false;
    if (outcome.kind === 'installed') {
      // `sessionUser` resolves once per document, so the fresh cookie needs a full load to count.
      location.assign('/');
    } else if (outcome.kind === 'invalid') {
      emailError.value = outcome.errors.email ?? '';
      passwordError.value = outcome.errors.password ?? '';
    } else if (outcome.kind === 'refused') {
      navigate('/login', { replace: true });
    } else {
      toast(t('dashboard.unreachable'), { type: 'error' });
    }
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
    effect(() => {
      control.title = t(
        revealed.value ? 'dashboard.login.hidePassword' : 'dashboard.login.showPassword',
      );
    });
    control.tabIndex = -1;
    return control;
  };

  return h(
    'form',
    {
      onSubmit: (event: SubmitEvent) => {
        event.preventDefault();
        void submit();
      },
    },
    field(prose(h('p', { class: 'ohne-muted' }, () => t('dashboard.install.welcomeMessage')))),
    field([
      fieldLabel(h('label', { for: 'email' }, () => t('dashboard.login.email'))),
      textInput(email, {
        autocomplete: 'email',
        autofocus: true,
        id: 'email',
        name: 'email',
        error: () => emailError.value !== '',
      }),
      when(
        () => emailError.value !== '',
        () => fieldMessage(() => emailError.value, { error: () => true }),
      ),
    ]),
    field([
      fieldLabel(h('label', { for: 'password' }, () => t('dashboard.login.password'))),
      textInput(password, {
        type: () => (revealed.value ? 'text' : 'password'),
        autocomplete: 'new-password',
        id: 'password',
        name: 'password',
        error: () => passwordError.value !== '',
        suffix: reveal,
      }),
      when(
        () => passwordError.value !== '',
        () => fieldMessage(() => passwordError.value, { error: () => true }),
      ),
    ]),
    field(button(() => t('dashboard.install.submit'), { type: 'submit', class: 'ohne-w-full' })),
  );
}

/**
 * Sends the setup to `POST /auth/install` and names how the attempt ended.
 * `installed` set the session cookie.
 * `invalid` carries the `422` per-field messages.
 * `refused` is the `403` of an already installed system; anything else is `unreachable`.
 */
async function install(email: string, password: string): Promise<InstallOutcome> {
  try {
    const response = await api('POST /auth/install', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (response.ok) return { kind: 'installed' };
    if (response.status === 422) {
      const answer = (await response.json()) as { data?: { errors?: Record<string, string> } };
      return { kind: 'invalid', errors: answer.data?.errors ?? {} };
    }
    if (response.status === 403) return { kind: 'refused' };
    return { kind: 'unreachable' };
  } catch {
    return { kind: 'unreachable' };
  }
}
