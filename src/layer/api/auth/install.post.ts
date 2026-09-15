import { defineHandler, forbidden, queryUntyped, readJSONBody } from 'ohnejs';

import type { User } from '../../auth/types.ts';

import { translate } from '../../../ohne/http/translate.ts';
import { createSession } from '../../auth/create-session.ts';
import { toUser } from '../../auth/to-user.ts';

/**
 * `POST /auth/install`
 *
 * Creates the first user from `{ email, password }` with the `admin` role, then signs it in.
 * Refuses with `403` once any user exists, so the route disarms itself after the setup.
 * The field pipeline validates the input; a failure answers `422` with per-field messages.
 * Success opens a persistent session, sets the cookie, and answers the `User` like login.
 */
export default defineHandler(async (): Promise<User> => {
  if (await queryUntyped('Users').exists()) throw forbidden(translate('auth.alreadyInstalled'));

  const body = await readJSONBody<{ email?: unknown; password?: unknown } | null>();
  const record = await queryUntyped('Users').createOrThrow({
    email: body?.email,
    password: body?.password,
    roles: ['admin'],
  });

  await createSession(record.UUID as string);
  return toUser(record);
});
