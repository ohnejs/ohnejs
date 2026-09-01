import { parseDuration } from 'ohne/utils';

import { useAuthConfig } from './config.ts';

/**
 * Returns how long a new session may live, in milliseconds.
 * A remembered session gets `auth.sessionMaxAge`, one without gets `auth.transientSessionMaxAge`.
 * `auth.sessionMaxAge` is the ceiling, so no session outlives it however it was opened.
 */
export function sessionLifetime(remember: boolean): number {
  const { sessionMaxAge, transientSessionMaxAge } = useAuthConfig();
  const ceiling = parseDuration(sessionMaxAge);
  return remember ? ceiling : Math.min(parseDuration(transientSessionMaxAge), ceiling);
}
