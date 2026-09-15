import { badRequest, defineHandler, queryUntyped, readJSONBody, unauthorized } from 'ohnejs';
import { isString, isUndefined } from 'ohnejs/utils';
import { passwordNeedsRehash, verifyPassword } from 'ohnejs/utils/crypto';

import type { User } from '../../auth/types.ts';

import { translate } from '../../../ohne/http/translate.ts';
import { normalizeEmail } from '../../auth/_email.ts';
import { userColumns } from '../../auth/_user.ts';
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
 */
export default defineHandler(async (): Promise<User> => {
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
    await queryUntyped('Users').where({ UUID: user.UUID }).update({ password });
  }

  await createSession(user.UUID, remember);
  return toUser(user);
});
