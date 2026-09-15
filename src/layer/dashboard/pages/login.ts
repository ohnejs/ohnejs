import {
  card,
  defineDashboardPage,
  navigate,
  sessionUser,
  setDocumentTitle,
  useT,
} from 'ohnejs/dashboard';
import { effect, isNullish, isString, parseSearchParams } from 'ohnejs/utils';

import { authLayout } from '../components/auth-layout.ts';
import { loginForm } from '../components/login-form.ts';
import { authLogo } from '../components/logo.ts';
import { installRequired } from './install.ts';

/**
 * The login page: the watermark logo over a card holding the sign-in form, on the auth layout.
 * The safe `next` destination is captured once.
 * A signing-in success and a signed-in visitor both land there through the session effect.
 * While the first-user setup is pending, the page yields to the install page.
 */
export default defineDashboardPage(() => {
  const t = useT();
  const destination = nextPath();

  effect(() => setDocumentTitle(t('dashboard.login.title')));

  effect(() => {
    if (!isNullish(sessionUser())) navigate(destination);
  });

  void installRequired().then((required) => {
    if (required) navigate('/install', { replace: true });
  });

  return authLayout(authLogo(), card(loginForm()));
});

/**
 * The post-login destination: the `next` query param when it is a safe same-origin path, else home.
 * A protocol-relative (`//`) or backslashed (`/\`) value is not safe and falls back to home.
 */
function nextPath(): string {
  const next = parseSearchParams(location.search).next;
  if (!isString(next)) return '/';
  if (next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\')) return next;
  return '/';
}
