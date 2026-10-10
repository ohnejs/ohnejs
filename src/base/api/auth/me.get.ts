import { defineHandler, query, unauthorized, useResponse } from 'ohnejs';
import { isNull, isUndefined } from 'ohnejs/utils';

import type { User } from '../../auth/types.ts';

import { isBearerRequest } from '../../auth/_cookie.ts';
import { accountLayout } from '../../auth/account-layout.ts';
import { toUser } from '../../auth/to-user.ts';
import { useUser } from '../../auth/use-user.ts';

/**
 * `GET /auth/me`
 *
 * Returns the signed-in `User`, its account settings included.
 * Without a live session it answers `204`: nobody is signed in.
 * A `Bearer` token that opens no session answers `401` instead, since an API client sent it on purpose.
 * A dead session cookie stays where it is, as it may belong to another app on the same host.
 * Every readable field the account layout places rides along, so the account page shows its value.
 */
export default defineHandler(async (): Promise<User | null> => {
  useResponse().headers.set('cache-control', 'no-store');
  const user = await useUser();
  if (!isNull(user)) {
    const layout = await accountLayout(user);
    const record = await query('Users').where('UUID', user.UUID).findFirst();
    if (!isUndefined(record)) return toUser(record, layout);
  }
  if (isBearerRequest()) throw unauthorized();
  return null;
});
