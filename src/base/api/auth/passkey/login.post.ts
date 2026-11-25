import { defineHandler, queryUntyped, readJSONBody, unauthorized } from 'ohnejs';
import { isUndefined } from 'ohnejs/utils';

import type { User } from '../../../auth/types.ts';

import { enforceLoginRateLimit } from '../../../auth/_login-rate-limit.ts';
import {
  readAssertion,
  requirePasskeys,
  takeChallenge,
  verifyAssertion,
} from '../../../auth/_passkeys.ts';
import { userColumns } from '../../../auth/_user.ts';
import { accountLayout } from '../../../auth/account-layout.ts';
import { createSession } from '../../../auth/create-session.ts';
import { toUser } from '../../../auth/to-user.ts';

/**
 * `POST /auth/passkey/login`
 *
 * Signs in with `{ credential, remember }`: a passkey's answer to `POST /auth/passkey/options`.
 * The challenge works once, and the passkey must have verified the user by Face ID, fingerprint or PIN.
 * Success opens a session and returns the `User`, like `POST /auth/login`.
 * Any refusal answers `401` with the same message; each attempt counts toward `auth.loginRateLimit`.
 * While `auth.passkeys` is off, it answers `404`.
 */
export default defineHandler(
  async (): Promise<User> => {
    requirePasskeys();
    const body = await readJSONBody<{ credential?: unknown; remember?: unknown } | null>();
    const assertion = readAssertion(body?.credential);
    await enforceLoginRateLimit();
    const UUID = await verifyAssertion(assertion, await takeChallenge('get'));

    const record = await queryUntyped('Users')
      .select(...userColumns())
      .where({ UUID })
      .findFirst();
    if (isUndefined(record)) throw unauthorized();
    await createSession(UUID, {
      method: 'passkey',
      multiFactor: true,
      remember: body?.remember === true,
    });
    return toUser(record, await accountLayout(toUser(record)));
  },
  { maxBodySize: '16kb' },
);
