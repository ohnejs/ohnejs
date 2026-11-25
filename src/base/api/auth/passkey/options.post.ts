import { defineHandler, queryUntyped } from 'ohnejs';
import { isNull } from 'ohnejs/utils';

import type { PasskeyRequestOptions } from '../../../ohne.contract.ts';

import { CHALLENGE_LIFETIME, issueChallenge, requirePasskeys } from '../../../auth/_passkeys.ts';
import { useUser } from '../../../auth/use-user.ts';

/**
 * `POST /auth/passkey/options`
 *
 * Issues a challenge to sign in or confirm with a passkey, in a signed cookie that lives five minutes.
 * Signed out, any passkey of the site may answer it.
 * Signed in, it lists the user's own passkeys, for `POST /auth/reauth`.
 * While `auth.passkeys` is off, it answers `404`.
 */
export default defineHandler(async (): Promise<PasskeyRequestOptions> => {
  const { rpID } = requirePasskeys();
  const user = await useUser();
  const owned = isNull(user)
    ? []
    : ((await queryUntyped('Passkeys')
        .select('credentialID', 'transports')
        .where({ user: user.UUID })
        .findMany()) as { credentialID: string; transports: string[] }[]);
  return {
    challenge: issueChallenge('get'),
    rpId: rpID,
    timeout: CHALLENGE_LIFETIME,
    userVerification: 'required',
    allowCredentials: owned.map(({ credentialID, transports }) => ({
      type: 'public-key',
      id: credentialID,
      transports,
    })),
  };
});
