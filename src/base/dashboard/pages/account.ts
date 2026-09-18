import { defineDashboardPage } from 'ohnejs/dashboard';

import { accountEditor } from '../components/account-editor.ts';
import { shell } from '../components/shell.ts';

/**
 * The account page: the signed-in user's own settings, at `/account`.
 * The editor scrolls its own column at full height, so the main area neither pads nor scrolls.
 */
export default defineDashboardPage(() =>
  shell(() => accountEditor(), { noMainPadding: true, noMainScroll: true }),
);
