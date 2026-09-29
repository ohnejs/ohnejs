import { ohneError } from 'ohnejs';
import { errorMessage } from 'ohnejs/utils';

import { loginRateLimiter } from '../auth/_login-rate-limit.ts';

assertLoginRateLimit();

/**
 * Refuses an invalid `auth.loginRateLimit` as the file loads, before the server takes a sign-in.
 */
function assertLoginRateLimit(): void {
  try {
    loginRateLimiter();
  } catch (error) {
    throw ohneError({
      title: 'Invalid `auth.loginRateLimit`',
      body: [errorMessage(error), '', 'Set a positive whole `limit` and `window`, or `false`.'],
    });
  }
}
