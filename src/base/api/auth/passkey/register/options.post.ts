import { defineHandler, queryUntyped } from 'ohnejs';
import { isEmpty, encodeBase64URL } from 'ohnejs/utils';

import type { User } from '../../../../auth/types.ts';
import type { PasskeyCreationOptions } from '../../../../ohne.contract.ts';

import { CHALLENGE_LIFETIME, issueChallenge, requirePasskeys } from '../../../../auth/_passkeys.ts';
import { isFresh, reauthRequired, requireSession } from '../../../../auth/_reauth.ts';
import { useAuthConfig } from '../../../../auth/config.ts';

/**
 * `POST /auth/passkey/register/options`
 *
 * Issues a challenge to add a passkey to the signed-in user's account, bound to that user for five minutes.
 * A user who has not proved who they are within `auth.reauthMaxAge` gets the `403` of `requireFreshSession`.
 * While password sign-in is off, a user without any passkey may add the first one without that proof.
 * No signed-in user is a `401`; while `auth.passkeys` is off, it answers `404`.
 */
export default defineHandler(async (): Promise<PasskeyCreationOptions> => {
  const { rpID } = requirePasskeys();
  const { user, session } = await requireSession();
  const owned = (await queryUntyped('Passkeys')
    .select('credentialID', 'transports')
    .where({ user: user.UUID })
    .findMany()) as { credentialID: string; transports: string[] }[];
  const firstOfPasskeyOnly = !useAuthConfig().passwordSignIn && isEmpty(owned);
  if (!isFresh(session) && !firstOfPasskeyOnly) throw await reauthRequired(user.UUID);

  return {
    challenge: issueChallenge('create', user.UUID),
    rp: { id: rpID, name: rpID },
    user: {
      id: encodeBase64URL(new TextEncoder().encode(user.UUID)),
      name: user.email,
      displayName: displayName(user),
    },
    pubKeyCredParams: [-7, -8, -257].map((alg) => ({ type: 'public-key', alg })),
    timeout: CHALLENGE_LIFETIME,
    attestation: 'none',
    authenticatorSelection: {
      residentKey: 'required',
      requireResidentKey: true,
      userVerification: 'required',
    },
    excludeCredentials: owned.map(({ credentialID, transports }) => ({
      type: 'public-key',
      id: credentialID,
      transports,
    })),
  };
});

/**
 * The name a passkey prompt shows for `user`: their full name, else their email.
 */
function displayName(user: User): string {
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ');
  return isEmpty(name) ? user.email : name;
}
