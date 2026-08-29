import { defineDashboardPage, navigate, sessionUser } from 'ohne/dashboard';
import { effect, isNull, isUndefined } from 'ohne/utils';

/**
 * The home page.
 * It renders nothing.
 * Once the session resolves, a signed-in visitor lands on `/overview` and a signed-out one on `/login`.
 * Both replace the history entry.
 */
export default defineDashboardPage(() => {
  effect(() => {
    const user = sessionUser();
    if (isUndefined(user)) return;
    navigate(isNull(user) ? '/login' : '/overview', { replace: true });
  });
  return null;
});
