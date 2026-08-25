import { defineDashboardPage, logout, navigate } from 'ohne/dashboard';

import { resetLayoutState } from '../components/shell.ts';

/**
 * The logout page, ported from Pruvious v4's `logout.vue`: a blank frame that renders nothing.
 * Construction fires the sign-out; once the session has ended it lands on the login page.
 * The persisted sidebar state resets, as the source resets its layout state.
 */
export default defineDashboardPage(() => {
  void logout().then(() => {
    resetLayoutState();
    navigate('/login');
  });
  return null;
});
