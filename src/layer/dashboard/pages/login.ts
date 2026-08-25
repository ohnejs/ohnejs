import { card, defineDashboardPage, navigate, sessionUser } from 'ohne/dashboard';
import { effect, isNull, isNullish } from 'ohne/utils';

import { authLayout } from '../components/auth-layout.ts';
import { loginForm } from '../components/login-form.ts';
import { authLogo } from '../components/logo.ts';

/**
 * The login page: the watermark logo over a card holding the sign-in form, on the auth layout.
 * The safe `next` destination is captured once; the session effect owns every navigation.
 * A signing-in success and a signed-in visitor both land there through the same effect.
 */
export default defineDashboardPage(() => {
  const destination = nextPath();

  effect(() => {
    if (!isNullish(sessionUser())) navigate(destination);
  });

  return authLayout(authLogo(), card(loginForm()));
});

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
