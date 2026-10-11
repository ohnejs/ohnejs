import { defineDashboardPage, useFrame } from 'ohnejs/dashboard';

import { accountEditor } from '../components/account-editor.ts';

/**
 * The account page: the signed-in user's own settings, at `/account`.
 * The editor scrolls its own column at full height, so the page fills the frame.
 */
export default defineDashboardPage(() => {
  useFrame({ fill: true });
  return accountEditor();
});
