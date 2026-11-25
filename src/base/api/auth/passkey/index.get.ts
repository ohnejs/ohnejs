import { defineHandler, queryUntyped, useResponse } from 'ohnejs';

import type { Passkey } from '../../../auth/types.ts';

import { requirePasskeys, toPasskey } from '../../../auth/_passkeys.ts';
import { requireSession } from '../../../auth/_reauth.ts';

/**
 * `GET /auth/passkey`
 *
 * Lists the signed-in user's passkeys, oldest first.
 * No signed-in user is a `401`; while `auth.passkeys` is off, it answers `404`.
 */
export default defineHandler(async (): Promise<Passkey[]> => {
  requirePasskeys();
  const { user } = await requireSession();
  useResponse().headers.set('cache-control', 'no-store');
  const records = await queryUntyped('Passkeys')
    .where({ user: user.UUID })
    .orderBy('createdAt')
    .findMany();
  return records.map(toPasskey);
});
