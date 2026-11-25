import { ohneError, useConfig, useEnv } from 'ohnejs';
import { isEmpty, isUndefined } from 'ohnejs/utils';

import { useAuthConfig } from '../auth/config.ts';

assertSignIn();

/**
 * Refuses an `auth` config that leaves no way to sign in, or passkeys without what they need.
 */
function assertSignIn(): void {
  const { passkeys, passwordSignIn } = useAuthConfig();
  if (passkeys === false) {
    if (passwordSignIn) return;
    throw ohneError({
      title: 'No way to sign in',
      body: [
        'You set `auth.password: false` but left `auth.passkeys` off.',
        '',
        'Set `auth.passkeys: true`.',
      ],
    });
  }
  if (useConfig().disable.collections.includes('Passkeys')) {
    throw ohneError({
      title: 'Passkeys need the `Passkeys` collection',
      body: [
        'You list it in `disable.collections`, but `auth.passkeys` is on.',
        '',
        'Remove `Passkeys` from `disable.collections`.',
      ],
    });
  }
  const secret = useEnv().get('COOKIE_SECRET');
  if (isUndefined(secret) || isEmpty(secret)) {
    throw ohneError({
      title: 'Passkeys need `COOKIE_SECRET`',
      body: [
        'The passkey challenge travels in a signed cookie.',
        '',
        'Set the `COOKIE_SECRET` env var to a long random value.',
      ],
    });
  }
}
