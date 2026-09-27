import { defineHandler } from 'ohnejs';

import { endOtherSessions } from '../../../auth/_sessions.ts';
import { requireUser } from '../../../auth/require-user.ts';

/**
 * `POST /auth/logout/others`
 *
 * Ends every other session of the signed-in user, keeping the one this request rides on.
 * A device signed in elsewhere is signed out at its next request.
 * No signed-in user is a `401`.
 */
export default defineHandler(async (): Promise<{ ok: true }> => {
  await endOtherSessions((await requireUser()).UUID);
  return { ok: true };
});
