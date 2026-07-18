import { query } from 'ohne';
import { parseDuration } from 'ohne/utils';
import { randomToken } from 'ohne/utils/crypto';

import { writeSessionCookie } from './_cookie.ts';
import { hashSessionToken } from './_token.ts';
import { useAuthConfig } from './config.ts';

/**
 * Opens a session for a user, storing its token hash and writing the session cookie.
 * The raw token exists only in the cookie; the row keeps its hash and an `expiresAt` from `sessionMaxAge`.
 * Call it after a successful `register` or `login`.
 *
 * @example
 * ```ts
 * await createSession(user.UUID)
 * ```
 */
export async function createSession(userUUID: string): Promise<void> {
  const token = randomToken(32);
  const expiresAt = Date.now() + parseDuration(useAuthConfig().sessionMaxAge);
  await query('Sessions').createOrThrow({
    user: userUUID,
    tokenHash: hashSessionToken(token),
    expiresAt,
  });
  writeSessionCookie(token);
}
