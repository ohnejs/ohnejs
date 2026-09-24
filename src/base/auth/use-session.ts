import { type Event, queryUntyped, tryUseEvent } from 'ohnejs';
import { isNull, isUndefined } from 'ohnejs/utils';

import type { Session } from './types.ts';

import { readSessionToken } from './_cookie.ts';
import { hashSessionToken } from './_token.ts';

const cache = new WeakMap<Event, Promise<Session | null>>();

/**
 * Returns the request's session, or `null` when there is none, memoized per request.
 * Outside a request there is no token to read, so it resolves to `null`.
 *
 * The token comes from the session cookie or a `Bearer` header, hashed, then matched against the store.
 * An expired session is deleted and read as `null`, so a stale cookie never resolves to a live session.
 *
 * @example
 * ```ts
 * const session = await useSession()
 * session?.user // -> the signed-in user's UUID, or undefined
 * ```
 */
export function useSession(): Promise<Session | null> {
  const event = tryUseEvent();
  if (isUndefined(event)) return Promise.resolve(null);
  const cached = cache.get(event);
  if (!isUndefined(cached)) return cached;

  const resolved = resolveSession();
  cache.set(event, resolved);
  return resolved;
}

/**
 * Looks the hashed request token up in `Sessions`, uncached; an expired row is deleted and reads as `null`.
 */
async function resolveSession(): Promise<Session | null> {
  const token = readSessionToken();
  if (isNull(token)) return null;

  const tokenHash = hashSessionToken(token);
  const session = (await queryUntyped('Sessions').unscoped().where({ tokenHash }).findFirst()) as
    | Session
    | undefined;
  if (isUndefined(session)) return null;

  if (session.expiresAt <= Date.now()) {
    await queryUntyped('Sessions').unscoped().where({ tokenHash }).delete();
    return null;
  }
  return session;
}
