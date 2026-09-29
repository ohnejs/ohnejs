import { defineHandler, query, unauthorized } from 'ohnejs';
import { isUndefined } from 'ohnejs/utils';

import type { User } from '../../auth/types.ts';

import { accountLayout } from '../../auth/account-layout.ts';
import { requireUser } from '../../auth/require-user.ts';
import { toUser } from '../../auth/to-user.ts';

/**
 * `GET /auth/me`
 *
 * Returns the signed-in `User`, its account settings included, or `401` when there is no live session.
 * Every readable field the account layout places rides along, so the account page shows its value.
 */
export default defineHandler(async (): Promise<User> => {
  const user = await requireUser();
  const layout = await accountLayout(user);
  const record = await query('Users').where('UUID', user.UUID).findFirst();
  if (isUndefined(record)) throw unauthorized();
  return toUser(record, layout);
});
