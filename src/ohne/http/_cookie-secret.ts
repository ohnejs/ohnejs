import { isEmpty, isUndefined } from '../../utils/index.ts';
import { useEnv } from '../env/use-env.ts';

/**
 * Resolves the cookie-signing secrets.
 * Signing uses the first; verification accepts any.
 * Throws when none is set, so a misconfigured app fails loud instead of signing under a blank key.
 */
export function cookieSecrets(): string[] {
  const secret = useEnv().get('COOKIE_SECRET');
  if (isUndefined(secret) || isEmpty(secret))
    throw new Error('Signed cookies need the `COOKIE_SECRET` env var (a long random value).');
  return [secret];
}
