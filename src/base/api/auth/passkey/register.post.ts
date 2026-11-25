import { badRequest, defineHandler, queryUntyped, readJSONBody, unauthorized } from 'ohnejs';
import { isNull, isString, isUndefined, verifyWebAuthnRegistration } from 'ohnejs/utils';

import type { Passkey } from '../../../auth/types.ts';

import { translate } from '../../../../ohne/http/translate.ts';
import {
  expectation,
  readAttestation,
  requirePasskeys,
  takeChallenge,
  toPasskey,
} from '../../../auth/_passkeys.ts';
import { requireSession } from '../../../auth/_reauth.ts';

/**
 * `POST /auth/passkey/register`
 *
 * Adds a passkey from `{ credential, name }`: the browser's answer to `POST /auth/passkey/register/options`.
 * The challenge works once, only for the user it was issued to, and the passkey must verify the user.
 * `name` labels it in the account's list; omitted, it is named `Passkey`.
 * Answers the new passkey; any refusal of the credential is a `401`.
 * No signed-in user is a `401`; while `auth.passkeys` is off, it answers `404`.
 */
export default defineHandler(
  async (): Promise<Passkey> => {
    const party = requirePasskeys();
    const { user } = await requireSession();
    const body = await readJSONBody<{ credential?: unknown; name?: unknown } | null>();
    const attestation = readAttestation(body?.credential);
    const name = body?.name ?? '';
    if (!isString(name)) throw badRequest();
    const challenge = await takeChallenge('create', user.UUID);
    const registered = isNull(challenge)
      ? undefined
      : await verifyWebAuthnRegistration(attestation, expectation(challenge, party)).catch(
          () => undefined,
        );
    if (isUndefined(registered)) throw unauthorized(translate('auth.invalidPasskey'));

    const record = await queryUntyped('Passkeys').createOrThrow({
      user: user.UUID,
      name: name.trim() || translate('auth.passkeys.defaultName'),
      credentialID: registered.id,
      publicKey: registered.publicKey,
      signCount: registered.signCount,
      transports: attestation.response.transports?.slice(0, 8) ?? [],
      backupEligible: registered.backupEligible,
      backedUp: registered.backedUp,
      createdAt: Date.now(),
    });
    return toPasskey(record);
  },
  { maxBodySize: '64kb' },
);
