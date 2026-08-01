import { query, queryUntyped } from 'ohne';
import { parseDuration } from 'ohne/utils';
import { randomToken } from 'ohne/utils/crypto';

import { writeSessionCookie } from './_cookie.ts';
import { hashSessionToken } from './_token.ts';
import { useAuthConfig } from './config.ts';

/**
 * Opens a session for a user, storing its token hash and writing the session cookie.
 * The raw token exists only in the cookie; the row keeps its hash and an `expiresAt` from `sessionMaxAge`.
 * Expired rows sweep out first, so abandoned sessions never accrete in the store.
 * Call it after a successful `register` or `login`.
 *
 * @example
 * ```ts
 * await createSession(user.UUID)
 * ```
 */
export async function createSession(userUUID: string): Promise<void> {
  const token = randomToken(32);
  const now = Date.now();
  await queryUntyped('Sessions')
    .where({ expiresAt: { atMost: now } })
    .delete();
  await query('Sessions').createOrThrow({
    user: userUUID,
    tokenHash: hashSessionToken(token),
    expiresAt: now + parseDuration(useAuthConfig().sessionMaxAge),
  });
  writeSessionCookie(token);
}
