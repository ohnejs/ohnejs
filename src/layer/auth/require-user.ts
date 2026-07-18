import { unauthorized } from 'ohne';
import { isNull } from 'ohne/utils';

import type { User } from './types.ts';

import { useUser } from './use-user.ts';

/**
 * Returns the signed-in user, or throws `401 Unauthorized` when there is none.
 * Valid only within a request; the guard a protected route opens with.
 *
 * @example
 * ```ts
 * export default defineHandler(async () => {
 *   const user = await requireUser()
 *   return { email: user.email }
 * })
 * ```
 */
export async function requireUser(): Promise<User> {
  const user = await useUser();
  if (isNull(user)) throw unauthorized();
  return user;
}
