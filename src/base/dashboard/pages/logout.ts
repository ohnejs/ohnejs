import { defineDashboardPage, logout, navigate, sessionUser } from 'ohnejs/dashboard';
import { isNull } from 'ohnejs/utils';

/**
 * The logout page: it renders nothing, outside the frame.
 * Construction fires the sign-out; once the session has ended it lands on the login page.
 * A visitor already signed out leaves at once instead of signing out again.
 * Rendering bare keeps the frame's own signed-out redirect from racing it with a `next` back here.
 */
export default defineDashboardPage(
  () => {
    if (isNull(sessionUser())) navigate('/login');
    else void logout().then(() => navigate('/login'));
    return null;
  },
  { frame: false },
);
