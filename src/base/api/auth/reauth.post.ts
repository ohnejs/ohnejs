import { badRequest, defineHandler, readJSONBody } from 'ohnejs';
import { isString, isUndefined } from 'ohnejs/utils';

import { checkPassword } from '../../auth/_check-password.ts';
import { enforceLoginRateLimit } from '../../auth/_login-rate-limit.ts';
import {
  readAssertion,
  requirePasskeys,
  takeChallenge,
  verifyAssertion,
} from '../../auth/_passkeys.ts';
import { markVerified, requireSession } from '../../auth/_reauth.ts';
import { useAuthConfig } from '../../auth/config.ts';

/**
 * `POST /auth/reauth`
 *
 * Confirms who the signed-in user is, so sensitive changes go through for `auth.reauthMaxAge`.
 * The body is `{ password }`, or `{ credential }`: a passkey's answer to `POST /auth/passkey/options`.
 * A wrong password is a `422` on `password`, and a refused passkey a `401`.
 * Each attempt counts toward `auth.loginRateLimit`.
 * A password while `auth.password` is `false`, or a body with neither, is a `400`.
 * No signed-in user is a `401`.
 */
export default defineHandler(
  async (): Promise<{ ok: true }> => {
    const { user, session } = await requireSession();
    const body = await readJSONBody<{ password?: unknown; credential?: unknown } | null>();
    if (!isUndefined(body?.credential)) {
      requirePasskeys();
      const assertion = readAssertion(body.credential);
      await enforceLoginRateLimit();
      await verifyAssertion(assertion, await takeChallenge('get'), user.UUID);
    } else {
      const password = body?.password;
      if (!isString(password) || !useAuthConfig().passwordSignIn) throw badRequest();
      await checkPassword(user.UUID, password, 'password');
    }
    await markVerified(session.UUID);
    return { ok: true };
  },
  { maxBodySize: '16kb' },
);
