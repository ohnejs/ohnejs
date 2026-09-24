import { queryUntyped } from 'ohnejs';
import { isNull } from 'ohnejs/utils';

import { clearSessionCookie, readSessionToken } from './_cookie.ts';
import { hashSessionToken } from './_token.ts';

/**
 * Ends the request's session: deletes its row from the store and clears the session cookie.
 * A request with no session still clears the cookie, so logout is idempotent.
 * Valid only within a request.
 *
 * @example
 * ```ts
 * export default defineHandler(async () => {
 *   await destroySession()
 *   return { ok: true }
 * })
 * ```
 */
export async function destroySession(): Promise<void> {
  const token = readSessionToken();
  if (!isNull(token)) {
    await queryUntyped('Sessions')
      .unscoped()
      .where({ tokenHash: hashSessionToken(token) })
      .delete();
  }
  clearSessionCookie();
}
