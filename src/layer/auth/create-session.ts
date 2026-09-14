import { query, queryUntyped } from 'ohnejs';
import { randomToken } from 'ohnejs/utils/crypto';

import { writeSessionCookie } from './_cookie.ts';
import { sessionLifetime } from './_lifetime.ts';
import { hashSessionToken } from './_token.ts';

/**
 * Opens a session for a user, storing its token hash and writing the session cookie.
 * The raw token exists only in the cookie; the row keeps its hash and a matching `expiresAt`.
 * Expired rows sweep out first, so abandoned sessions never accrete in the store.
 * A remembered session lasts `auth.sessionMaxAge`, one without lasts `auth.transientSessionMaxAge`.
 * The cookie of a session without remember me additionally ends with the browser session.
 * Call it after a successful `register` or `login`.
 *
 * @example
 * ```ts
 * await createSession(user.UUID)
 * ```
 */
export async function createSession(userUUID: string, remember = true): Promise<void> {
  const token = randomToken(32);
  const now = Date.now();
  const lifetime = sessionLifetime(remember);
  await queryUntyped('Sessions')
    .where({ expiresAt: { atMost: now } })
    .delete();
  await query('Sessions').createOrThrow({
    user: userUUID,
    tokenHash: hashSessionToken(token),
    expiresAt: now + lifetime,
  });
  writeSessionCookie(token, remember ? lifetime : undefined);
}
