import { queryUntyped, type Transaction, tryUseEvent } from 'ohnejs';
import { isNull, isUndefined } from 'ohnejs/utils';

import { readSessionToken } from './_cookie.ts';
import { hashSessionToken } from './_token.ts';

/**
 * Ends every session of `user` except the one the current request rides on.
 * Outside a request, or on a request without a session token, it ends them all.
 * Pass `tx` to delete inside an open write transaction.
 */
export async function endOtherSessions(user: string, tx?: Transaction): Promise<void> {
  const token = isUndefined(tryUseEvent()) ? null : readSessionToken();
  const sessions = queryUntyped('Sessions').unscoped();
  if (!isUndefined(tx)) sessions.use(tx);
  await sessions
    .where(
      isNull(token)
        ? { user }
        : { user, tokenHash: { not: { equalsTo: hashSessionToken(token) } } },
    )
    .delete();
}
