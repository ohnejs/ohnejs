import {
  badRequest,
  checkWriteInput,
  defineHandler,
  queryMetadata,
  queryUntyped,
  readJSONBody,
} from 'ohnejs';
import { isPlainObject, pick } from 'ohnejs/utils';

import type { User } from '../../auth/types.ts';

import { accountFields, accountLayout } from '../../auth/account-layout.ts';
import { requireUser } from '../../auth/require-user.ts';
import { toUser } from '../../auth/to-user.ts';

/**
 * `PATCH /auth/me`
 *
 * Updates the signed-in user's own account settings from a partial body and answers the whole `User`.
 * The body may name only the fields the account layout places; `email`, `roles`, or any other key is a `422`.
 * The write runs through the field pipeline, so sanitizers, validators, and the password hash apply.
 * A validator failure answers `422` with per-field messages; a body that is not an object is a `400`.
 * No signed-in user is a `401`.
 */
export default defineHandler(async (): Promise<User> => {
  const user = await requireUser();
  const body = await readJSONBody();
  if (!isPlainObject(body)) throw badRequest();
  const allowed = accountFields(await accountLayout(user));
  checkWriteInput(body, pick(queryMetadata('Users').fields, allowed), 'update');
  const records = await queryUntyped('Users').where({ UUID: user.UUID }).updateOrThrow(body);
  return toUser(records[0]);
});
