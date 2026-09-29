import {
  badRequest,
  defineHandler,
  queryUntyped,
  readJSONBody,
  unauthorized,
  useDatabase,
} from 'ohnejs';
import { isString, isUndefined } from 'ohnejs/utils';
import { passwordNeedsRehash, verifyPassword } from 'ohnejs/utils/crypto';

import type { User } from '../../auth/types.ts';

import { translate } from '../../../ohne/http/translate.ts';
import { normalizeEmail } from '../../auth/_email.ts';
import { enforceLoginRateLimit } from '../../auth/_login-rate-limit.ts';
import { acquirePasswordPermit } from '../../auth/_password-permits.ts';
import { passwordRehashes } from '../../auth/_sessions.ts';
import { userColumns } from '../../auth/_user.ts';
import { accountLayout } from '../../auth/account-layout.ts';
import { useAuthConfig } from '../../auth/config.ts';
import { createSession } from '../../auth/create-session.ts';
import { dummyVerify } from '../../auth/dummy-verify.ts';
import { toUser } from '../../auth/to-user.ts';

/**
 * `POST /auth/login`
 *
 * Verifies `{ email, password }`, opens a session, and returns the `User`.
 * An unknown email and a wrong password both answer `401` with the same message, by design.
 * A success whose stored hash predates the configured scrypt cost rehashes it at the current one.
 * Stored costs so converge to the cost `dummyVerify` equalizes at, keeping sign-in timing uniform.
 * Past `auth.loginRateLimit` attempts from one client network, it answers `429`.
 * A process already running its share of password checks, or one IP already running one, answers `503`.
 * A body past 4 KB is a `413`.
 */
export default defineHandler(
  async (): Promise<User> => {
    await enforceLoginRateLimit();
    const body = await readJSONBody<{
      email?: unknown;
      password?: unknown;
      remember?: unknown;
    } | null>();
    const email = body?.email;
    const password = body?.password;
    const remember = body?.remember === true;
    if (!isString(email) || !isString(password))
      throw badRequest(translate('auth.invalidCredentials'));

    const release = acquirePasswordPermit();
    const user = await verifyCredentials(email, password).finally(release);

    await createSession(user.UUID, remember);
    return toUser(user, await accountLayout(toUser(user)));
  },
  { maxBodySize: '4kb' },
);

/**
 * The user `email` names, once `password` matches, rehashed when its stored cost is outdated.
 * An unknown email spends a `dummyVerify`, then answers the same `401` a wrong password does.
 */
async function verifyCredentials(
  email: string,
  password: string,
): Promise<Record<string, unknown> & { UUID: string; password: string }> {
  const user = (await queryUntyped('Users')
    .select('password', ...userColumns())
    .where({ email: normalizeEmail(email) })
    .findFirst()) as (Record<string, unknown> & { UUID: string; password: string }) | undefined;

  if (isUndefined(user)) {
    await dummyVerify(password);
    throw unauthorized(translate('auth.invalidCredentials'));
  }
  if (!(await verifyPassword(password, user.password)))
    throw unauthorized(translate('auth.invalidCredentials'));

  if (passwordNeedsRehash(user.password, useAuthConfig().password)) {
    await useDatabase().transaction(async (tx) => {
      passwordRehashes.add(tx);
      await queryUntyped('Users').use(tx).where({ UUID: user.UUID }).update({ password });
    });
  }
  return user;
}
