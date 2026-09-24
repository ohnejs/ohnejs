import { defineHandler, queryUntyped } from 'ohnejs';

import type { Session } from '../../../auth/types.ts';

import { requireUser } from '../../../auth/require-user.ts';
import { useSession } from '../../../auth/use-session.ts';

/**
 * `POST /auth/logout/others`
 *
 * Ends every other session of the signed-in user, keeping the one this request rides on.
 * A device signed in elsewhere is signed out at its next request.
 * `requireUser` resolves the user through the session, so the session is present once it passes.
 * No signed-in user is a `401`.
 */
export default defineHandler(async (): Promise<{ ok: true }> => {
  const user = await requireUser();
  const session = (await useSession()) as Session;
  await queryUntyped('Sessions')
    .unscoped()
    .where({ user: user.UUID, UUID: { not: { equalsTo: session.UUID } } })
    .delete();
  return { ok: true };
});
