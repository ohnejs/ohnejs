import {
  applyHook,
  badRequest,
  defineHandler,
  notFound,
  queryUntyped,
  readJSONBody,
  unauthorized,
  useDatabase,
} from 'ohnejs';
import { isNull, isString, isUndefined, normalizeEmail } from 'ohnejs/utils';
import { passwordNeedsRehash, verifyPassword } from 'ohnejs/utils/crypto';

import type { CredentialRejection, User } from '../../auth/types.ts';

import { translate } from '../../../ohne/http/translate.ts';
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
 * A process already running its share of password checks, or one client network running one, answers `503`.
 * A `503` or a `400` costs no attempt.
 * A body past 4 KB is a `413`.
 * While `auth.password` is `false`, it answers `404`.
 */
export default defineHandler(
  async (): Promise<User> => {
    if (!useAuthConfig().passwordSignIn) throw notFound();
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
    const verdict = await enforceLoginRateLimit()
      .then(() => verifyCredentials(email, password))
      .finally(release);
    if ('rejected' in verdict) {
      await applyHook('auth:credential-rejected', verdict.rejected);
      throw unauthorized(translate('auth.invalidCredentials'));
    }
    const { user } = verdict;

    await createSession(user.UUID, { method: 'password', remember });
    return toUser(user, await accountLayout(toUser(user)));
  },
  { maxBodySize: '4kb' },
);

/**
 * The user `email` names, once `password` matches, rehashed when its stored cost is outdated.
 * A refusal resolves what `auth:credential-rejected` receives, so the hook runs after the permit is back.
 * An unknown email or a user without a password spends a `dummyVerify`, so it takes as long as a wrong one.
 */
async function verifyCredentials(
  email: string,
  password: string,
): Promise<
  { user: Record<string, unknown> & { UUID: string } } | { rejected: CredentialRejection }
> {
  const address = normalizeEmail(email);
  const user = (await queryUntyped('Users')
    .select('password', ...userColumns())
    .where({ email: address })
    .findFirst()) as
    | (Record<string, unknown> & { UUID: string; password: string | null })
    | undefined;

  if (isUndefined(user)) {
    await dummyVerify(password);
    return { rejected: { method: 'password', email: address } };
  }
  if (isNull(user.password)) {
    await dummyVerify(password);
    return { rejected: { method: 'password', email: address, user: user.UUID } };
  }
  if (!(await verifyPassword(password, user.password))) {
    return { rejected: { method: 'password', email: address, user: user.UUID } };
  }

  if (passwordNeedsRehash(user.password, useAuthConfig().password)) {
    await useDatabase().transaction(async (tx) => {
      passwordRehashes.add(tx);
      await queryUntyped('Users').use(tx).where({ UUID: user.UUID }).update({ password });
    });
  }
  return { user };
}
