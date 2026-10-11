import {
  api,
  button,
  card,
  defineDashboardPage,
  formField,
  h,
  icon,
  navigate,
  prose,
  sessionUser,
  textInput,
  toast,
  useAction,
  useDocumentTitle,
  useT,
} from 'ohnejs/dashboard';
import { effect, isNullish, isPlainObject, ref } from 'ohnejs/utils';

import { authLayout } from '../components/auth-layout.ts';
import { authLogo } from '../components/logo.ts';

/**
 * The install page: the first-user setup card on the auth layout.
 * A welcome note, the name, email, and password create the primary administrator account.
 * The server signs the new account in; success lands on home through a full document load.
 * An installed system redirects to the login page; a signed-in visitor goes home.
 */
export default defineDashboardPage(
  () => {
    useDocumentTitle('dashboard.install.title');

    effect(() => {
      if (!isNullish(sessionUser())) navigate('/');
    });

    void installRequired().then((required) => {
      if (!required) navigate('/login', { replace: true });
    });

    return authLayout(authLogo(), card(installForm()));
  },
  { frame: false },
);

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

/**
 * The first-user form: the welcome note, the name, email, and password over a full-width submit.
 * The name is optional; an emptied input sends `null`.
 * A `422` routes its per-field messages under the inputs; a `403` yields to the login page.
 * Any other failure raises a toast.
 */
function installForm(): HTMLElement {
  const t = useT();
  const firstName = ref('');
  const lastName = ref('');
  const email = ref('');
  const password = ref('');
  const revealed = ref(false);
  const firstNameError = ref('');
  const lastNameError = ref('');
  const emailError = ref('');
  const passwordError = ref('');

  const showErrors = (errors: Readonly<Record<string, string>>): void => {
    firstNameError.value = errors.firstName ?? '';
    lastNameError.value = errors.lastName ?? '';
    emailError.value = errors.email ?? '';
    passwordError.value = errors.password ?? '';
  };

  const install = useAction('POST /auth/install', {
    // `sessionUser` resolves once per document, so the fresh cookie needs a full load to count.
    onDone: () => location.assign('/'),
    onError: (error) => {
      if (error.status === 403) navigate('/login', { replace: true });
      else if (error.status === 422) showErrors(fieldErrors(error.data));
      else toast(error.message, { type: 'error' });
    },
  });

  const submit = (): void => {
    showErrors({});
    void install.run({
      body: {
        firstName: firstName.value === '' ? null : firstName.value,
        lastName: lastName.value === '' ? null : lastName.value,
        email: email.value,
        password: password.value,
      },
    });
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
        submit();
      },
    },
    formField(prose(h('p', { class: 'ohne-muted' }, () => t('dashboard.install.welcomeMessage')))),
    formField(
      textInput(firstName, {
        autocomplete: 'given-name',
        autofocus: true,
        id: 'firstName',
        name: 'firstName',
      }),
      { label: 'dashboard.install.firstName', error: () => firstNameError.value },
    ),
    formField(
      textInput(lastName, {
        autocomplete: 'family-name',
        id: 'lastName',
        name: 'lastName',
      }),
      { label: 'dashboard.install.lastName', error: () => lastNameError.value },
    ),
    formField(
      textInput(email, {
        autocomplete: 'email',
        id: 'email',
        name: 'email',
      }),
      { label: 'dashboard.login.email', error: () => emailError.value },
    ),
    formField(
      textInput(password, {
        type: () => (revealed.value ? 'text' : 'password'),
        autocomplete: 'new-password',
        id: 'password',
        name: 'password',
        suffix: reveal,
      }),
      { label: 'dashboard.login.password', error: () => passwordError.value },
    ),
    formField(
      button(() => t('dashboard.install.submit'), {
        type: 'submit',
        class: 'ohne-w-full',
        loading: () => install.busy(),
      }),
    ),
  );
}

/**
 * The per-field messages a `422` carries under `data.errors`.
 */
function fieldErrors(data: unknown): Readonly<Record<string, string>> {
  return isPlainObject(data) && isPlainObject<Record<string, string>>(data.errors)
    ? data.errors
    : {};
}
