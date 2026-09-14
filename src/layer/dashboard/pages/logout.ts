import { defineDashboardPage, logout, navigate } from 'ohnejs/dashboard';

import { resetLayoutState } from '../components/shell.ts';

/**
 * The logout page: a blank frame that renders nothing.
 * Construction fires the sign-out; once the session has ended it lands on the login page.
 * The persisted sidebar state resets.
 */
export default defineDashboardPage(() => {
  void logout().then(() => {
    resetLayoutState();
    navigate('/login');
  });
  return null;
});
