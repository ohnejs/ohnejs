import {
  button,
  css,
  defineDashboardPage,
  h,
  labeledField,
  login,
  type LoginOutcome,
  navigate,
  sessionUser,
  textInput,
  useT,
} from 'ohne/dashboard';
import { effect, isNull, isNullish, ref } from 'ohne/utils';

css`
  .login {
    min-height: 100%;
    display: grid;
    place-items: center;
  }

  .login-form {
    width: 300px;
    padding-bottom: 10vh;
  }

  .login-word {
    font-size: 28px;
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  .login-rule {
    border: none;
    border-top: 1px solid var(--hairline);
    margin: 14px 0 32px;
  }

  .login-error {
    min-height: 20px;
    margin: 16px 0 12px;
    font-size: 12px;
    color: var(--danger);
  }
`;

/**
 * The login page: wordmark, a hairline, two underlined fields, one accent action.
 * The safe `next` destination is captured once; the session effect owns every navigation.
 * A signing-in success and a signed-in visitor both land there through the same effect.
 */
export default defineDashboardPage(() => {
  const t = useT();
  const destination = nextPath();
  const email = ref('');
  const password = ref('');
  const problem = ref<Exclude<LoginOutcome, 'signed-in'> | null>(null);
  const busy = ref(false);

  effect(() => {
    if (!isNullish(sessionUser())) navigate(destination);
  });

  const submit = (event: SubmitEvent): void => {
    event.preventDefault();
    if (busy.value) return;
    busy.value = true;
    problem.value = null;
    void login(email.value, password.value).then((outcome) => {
      busy.value = false;
      if (outcome !== 'signed-in') problem.value = outcome;
    });
  };

  return h(
    'div',
    { class: 'login' },
    h(
      'form',
      { class: 'login-form', onSubmit: submit },
      h('div', { class: 'login-word' }, 'ohne'),
      h('hr', { class: 'login-rule' }),
      labeledField(
        () => t('dashboard.login.email'),
        textInput(email, { type: 'email', autofocus: true }),
      ),
      labeledField(() => t('dashboard.login.password'), textInput(password, { type: 'password' })),
      h('div', { class: 'login-error' }, () => problemText(t, problem.value)),
      button(() => t('dashboard.login.submit'), { type: 'submit', disabled: () => busy.value }),
    ),
  );
});

/**
 * The error line for a failed attempt: wrong credentials and an unreachable server read differently.
 */
function problemText(
  t: (key: 'auth.invalidCredentials' | 'dashboard.login.unreachable') => string,
  problem: Exclude<LoginOutcome, 'signed-in'> | null,
): string {
  if (isNull(problem)) return '';
  return problem === 'invalid' ? t('auth.invalidCredentials') : t('dashboard.login.unreachable');
}

/**
 * The post-login destination: the `next` query param when it is a safe same-origin path, else home.
 * A protocol-relative (`//`) or backslashed (`/\`) value is not safe and falls back to home.
 */
function nextPath(): string {
  const next = new URLSearchParams(location.search).get('next');
  if (isNull(next)) return '/';
  if (next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\')) return next;
  return '/';
}
