import { defineHandler } from 'ohnejs';

import { destroySession } from '../../auth/destroy-session.ts';

/**
 * `POST /auth/logout`
 *
 * Ends the current session and clears the session cookie.
 * Idempotent: a request with no session still answers `{ ok: true }`.
 */
export default defineHandler(async (): Promise<{ ok: true }> => {
  await destroySession();
  return { ok: true };
});
