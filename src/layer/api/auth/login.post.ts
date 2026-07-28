import { badRequest, defineHandler, queryUntyped, readJSONBody, unauthorized } from 'ohne';
import { isString, isUndefined } from 'ohne/utils';
import { verifyPassword } from 'ohne/utils/crypto';

import type { User } from '../../auth/types.ts';

import { translate } from '../../../ohne/http/translate.ts';
import { normalizeEmail } from '../../auth/_email.ts';
import { createSession } from '../../auth/create-session.ts';
import { dummyVerify } from '../../auth/dummy-verify.ts';

/**
 * `POST /auth/login`
 *
 * Verifies `{ email, password }`, opens a session, and returns `{ UUID, email, roles }`.
 * An unknown email and a wrong password both answer `401` with the same message, by design.
 */
export default defineHandler(async (): Promise<User> => {
  const body = await readJSONBody<{ email?: unknown; password?: unknown } | null>();
  const email = body?.email;
  const password = body?.password;
  if (!isString(email) || !isString(password))
    throw badRequest(translate('auth.invalidCredentials'));

  const user = (await queryUntyped('Users')
    .select('UUID', 'email', 'password', 'roles')
    .where({ email: normalizeEmail(email) })
    .findFirst()) as (User & { password: string }) | undefined;

  if (isUndefined(user)) {
    await dummyVerify(password);
    throw unauthorized(translate('auth.invalidCredentials'));
  }
  if (!(await verifyPassword(password, user.password)))
    throw unauthorized(translate('auth.invalidCredentials'));

  await createSession(user.UUID);
  return { UUID: user.UUID, email: user.email, roles: user.roles };
});
