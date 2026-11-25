import { conflict, defineHandler, notFound, queryUntyped, useDatabase } from 'ohnejs';

import { translate } from '../../../../ohne/http/translate.ts';
import { requirePasskeys } from '../../../auth/_passkeys.ts';
import { requireFreshSession } from '../../../auth/_reauth.ts';
import { useAuthConfig } from '../../../auth/config.ts';

/**
 * `DELETE /auth/passkey/[uuid]`
 *
 * Removes one of the signed-in user's passkeys, answering `204`.
 * A user who has not proved who they are within `auth.reauthMaxAge` gets the `403` of `requireFreshSession`.
 * While password sign-in is off, removing the user's last passkey is a `409`.
 * Another user's passkey is a `404`.
 * No signed-in user is a `401`; while `auth.passkeys` is off, it answers `404`.
 */
export default defineHandler(async ({ params }): Promise<null> => {
  requirePasskeys();
  const { user } = await requireFreshSession();
  await useDatabase().transaction(async (tx) => {
    const { deleted } = await queryUntyped('Passkeys')
      .use(tx)
      .where({ UUID: params.uuid, user: user.UUID })
      .delete();
    if (deleted === 0) throw notFound();
    const left = queryUntyped('Passkeys').use(tx).where({ user: user.UUID });
    if (!useAuthConfig().passwordSignIn && !(await left.exists())) {
      throw conflict(translate('auth.lastPasskey'));
    }
  }, 'immediate');
  return null;
});
