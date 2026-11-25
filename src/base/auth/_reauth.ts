import { forbidden, type HTTPError, queryUntyped, unauthorized } from 'ohnejs';
import { isNull, parseDuration } from 'ohnejs/utils';

import type { Session, User } from './types.ts';

import { translate } from '../../ohne/http/translate.ts';
import { useAuthConfig } from './config.ts';
import { useSession } from './use-session.ts';
import { useUser } from './use-user.ts';

/**
 * The signed-in user and session; `401` without one.
 */
export async function requireSession(): Promise<{ user: User; session: Session }> {
  const [user, session] = await Promise.all([useUser(), useSession()]);
  if (isNull(user) || isNull(session)) throw unauthorized();
  return { user, session };
}

/**
 * Whether the session's user proved who they are within `auth.reauthMaxAge`.
 */
export function isFresh(session: Session): boolean {
  return (session.verifiedAt ?? 0) > Date.now() - parseDuration(useAuthConfig().reauthMaxAge);
}

/**
 * The signed-in user and session, once the user proved who they are within `auth.reauthMaxAge`.
 * A stale session answers `403` with `{ reauth: true, passkey }`; `passkey` says whether the user owns one.
 * The client confirms through `POST /auth/reauth` and retries; the dashboard's `withReauth` does both.
 *
 * @example
 * ```ts
 * const { user } = await requireFreshSession()
 * ```
 */
export async function requireFreshSession(): Promise<{ user: User; session: Session }> {
  const signedIn = await requireSession();
  if (!isFresh(signedIn.session)) throw await reauthRequired(signedIn.user.UUID);
  return signedIn;
}

/**
 * The `403` that asks `user` to confirm who they are, saying whether they can with a passkey.
 */
export async function reauthRequired(user: string): Promise<HTTPError> {
  const passkey =
    useAuthConfig().passkeys !== false && (await queryUntyped('Passkeys').where({ user }).exists());
  return forbidden(translate('auth.reauthRequired'), { reauth: true, passkey });
}

/**
 * Records that the session's user just proved who they are.
 */
export async function markVerified(session: string): Promise<void> {
  await queryUntyped('Sessions')
    .unscoped()
    .where({ UUID: session })
    .update({ verifiedAt: Date.now() });
}
