import { defineDashboardPage, logout, navigate, sessionUser } from 'ohnejs/dashboard';
import { isNull } from 'ohnejs/utils';

import { resetLayoutState } from '../components/shell.ts';

/**
 * The logout page: a blank frame that renders nothing.
 * Construction fires the sign-out; once the session has ended it lands on the login page.
 * A visitor already signed out leaves at once instead of signing out again.
 * The persisted sidebar state resets.
 */
export default defineDashboardPage(() => {
  const leave = (): void => {
    resetLayoutState();
    navigate('/login');
  };
  if (isNull(sessionUser())) leave();
  else void logout().then(leave);
  return null;
});
