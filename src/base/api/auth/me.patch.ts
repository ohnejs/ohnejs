import {
  badRequest,
  checkWriteInput,
  defineHandler,
  queryMetadata,
  queryUntyped,
  readJSONBody,
  unauthorized,
} from 'ohnejs';
import { hasKey, isEmpty, isPlainObject, isString, isUndefined, pick } from 'ohnejs/utils';
import { verifyPassword } from 'ohnejs/utils/crypto';

import type { User } from '../../auth/types.ts';

import { validationError } from '../../../ohne/query/write/errors.ts';
import { enforceLoginRateLimit } from '../../auth/_login-rate-limit.ts';
import { acquirePasswordPermit } from '../../auth/_password-permits.ts';
import { accountFields, accountLayout } from '../../auth/account-layout.ts';
import { requireUser } from '../../auth/require-user.ts';
import { toUser } from '../../auth/to-user.ts';
import { linkReach } from '../../collections-api/gate.ts';

/**
 * `PATCH /auth/me`
 *
 * Updates the signed-in user's own account settings from a partial body and answers the whole `User`.
 * The body may name only the fields the account layout places; `email`, `roles`, or any other key is a `422`.
 * A new `password` needs `currentPassword`, the one it replaces; a check counts toward `auth.loginRateLimit`.
 * The write runs through the field pipeline, so sanitizers, validators, and the password hash apply.
 * A link the body names must be one the user could read, as on the collections API.
 * A validator failure answers `422` with per-field messages; a body that is not an object is a `400`.
 * No signed-in user is a `401`.
 */
export default defineHandler(async (): Promise<User> => {
  const user = await requireUser();
  const body = await readJSONBody();
  if (!isPlainObject(body)) throw badRequest();
  const { currentPassword, ...input } = body;
  const layout = await accountLayout(user);
  checkWriteInput(input, pick(queryMetadata('Users').fields, accountFields(layout)), 'update');
  if (hasKey(input, 'password')) {
    if (!isString(currentPassword) || isEmpty(currentPassword))
      throw validationError({ currentPassword: 'validation.required' });
    const release = acquirePasswordPermit();
    await enforceLoginRateLimit()
      .then(() => checkPassword(user.UUID, currentPassword))
      .finally(release);
  }
  const [record] = await queryUntyped('Users')
    .linkReach(linkReach)
    .where({ UUID: user.UUID })
    .updateOrThrow(input);
  if (isUndefined(record)) throw unauthorized();
  return toUser(record, layout);
});

/**
 * Answers `422` on `currentPassword` unless `password` is the one the user signs in with.
 */
async function checkPassword(UUID: string, password: string): Promise<void> {
  const row = await queryUntyped('Users').select('password').where({ UUID }).findFirst();
  if (isUndefined(row)) throw unauthorized();
  if (!isString(row.password) || !(await verifyPassword(password, row.password)))
    throw validationError({ currentPassword: 'auth.incorrectPassword' });
}
