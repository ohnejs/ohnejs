import { type Event, query, tryUseEvent } from 'ohne';
import { isNull, isUndefined } from 'ohne/utils';

import type { User } from './types.ts';

import { useSession } from './use-session.ts';

const cache = new WeakMap<Event, Promise<User | null>>();

/**
 * Returns the signed-in user, or `null` when the request has no live session, memoized per request.
 * Outside a request there is no session, so it resolves to `null`.
 *
 * The result carries only `UUID`, `email`, and `roles`, never the password hash.
 * It is therefore safe to return as-is.
 * Reach for `requireUser` when a route must have a user and a missing one is a `401`.
 *
 * @example
 * ```ts
 * const user = await useUser()
 * if (user) greet(user.email)
 * ```
 */
export function useUser(): Promise<User | null> {
  const event = tryUseEvent();
  if (isUndefined(event)) return Promise.resolve(null);
  const cached = cache.get(event);
  if (!isUndefined(cached)) return cached;

  const resolved = resolveUser();
  cache.set(event, resolved);
  return resolved;
}

async function resolveUser(): Promise<User | null> {
  const session = await useSession();
  if (isNull(session) || isNull(session.user)) return null;

  const user = (await query('Users')
    .where('UUID', session.user)
    .select('UUID', 'email', 'roles')
    .findFirst()) as User | undefined;
  return isUndefined(user) ? null : user;
}
