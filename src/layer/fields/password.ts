import { defineField } from 'ohnejs';
import { hashPassword } from 'ohnejs/utils/crypto';

import { useAuthConfig } from '../auth/config.ts';

/**
 * The `password` field type: takes a plaintext password and stores its scrypt hash.
 *
 * Sanitizers and validators see the plaintext, so a policy rule checks what the caller sent.
 * `serialize` hashes just before storage with the auth config's scrypt settings.
 * The plaintext therefore never lands anywhere; a read returns the stored hash.
 * `verifyPassword` checks a sign-in attempt against that hash, as the `login` route does.
 */
export default defineField({
  columnType: 'text',
  serialize: (value) => hashPassword(value as string, useAuthConfig().password),
});
