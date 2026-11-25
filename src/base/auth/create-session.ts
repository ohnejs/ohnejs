import { applyHook, queryUntyped } from 'ohnejs';
import { isBoolean } from 'ohnejs/utils';
import { randomToken } from 'ohnejs/utils/crypto';

import type { SignIn } from './types.ts';

import { writeSessionCookie } from './_cookie.ts';
import { sessionLifetime } from './_lifetime.ts';
import { hashSessionToken } from './_token.ts';

/**
 * How a session opens, for `createSession`.
 */
export interface CreateSessionOptions {
  /**
   * What the user signed in with, as `auth:signed-in` receives it.
   *
   * @default
   * 'custom'
   */
  method?: SignIn['method'];

  /**
   * A remembered session lasts `auth.sessionMaxAge`, one without lasts `auth.transientSessionMaxAge`.
   *
   * @default
   * true
   */
  remember?: boolean;

  /**
   * Whether the sign-in proved two factors at once.
   *
   * @default
   * false
   */
  multiFactor?: boolean;
}

/**
 * Opens a session for a user, storing its token hash and writing the session cookie.
 * The raw token exists only in the cookie; the row keeps its hash and a matching `expiresAt`.
 * Expired rows sweep out first, so abandoned sessions never accrete in the store.
 * The cookie of a session without remember me additionally ends with the browser session.
 * The session counts as freshly verified, so a sensitive change right after needs no second proof.
 * It fires `auth:signed-in` before the cookie is written; a throw there removes the session again.
 * Call it after your own sign-in or signup check succeeds.
 * It resolves to the new session's `UUID`.
 * A boolean in place of `options` is its `remember`.
 *
 * @example
 * ```ts
 * await createSession(user.UUID, { method: 'password' }) // -> '0f6c...'
 * ```
 */
export async function createSession(
  user: string,
  options: CreateSessionOptions | boolean = {},
): Promise<string> {
  const {
    method = 'custom',
    remember = true,
    multiFactor = false,
  } = isBoolean(options) ? { remember: options } : options;
  const token = randomToken(32);
  const now = Date.now();
  const lifetime = sessionLifetime(remember);
  await queryUntyped('Sessions')
    .unscoped()
    .where({ expiresAt: { atMost: now } })
    .delete();
  const { UUID } = await queryUntyped('Sessions')
    .unscoped()
    .createOrThrow({
      user,
      tokenHash: hashSessionToken(token),
      expiresAt: now + lifetime,
      verifiedAt: now,
    });
  const session = UUID as string;
  await applyHook('auth:signed-in', { user, session, method, multiFactor }).catch(async (error) => {
    await queryUntyped('Sessions').unscoped().where({ UUID: session }).delete();
    throw error;
  });
  writeSessionCookie(token, remember ? lifetime : undefined);
  return session;
}
