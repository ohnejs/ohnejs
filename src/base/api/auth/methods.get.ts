import { defineHandler } from 'ohnejs';

import { useAuthConfig } from '../../auth/config.ts';

/**
 * `GET /auth/methods`
 *
 * Answers which ways of signing in the app offers, so a sign-in page shows only those.
 */
export default defineHandler((): { password: boolean; passkeys: boolean } => {
  const { passwordSignIn, passkeys } = useAuthConfig();
  return { password: passwordSignIn, passkeys: passkeys !== false };
});
