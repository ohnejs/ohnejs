import { defineCollection, field } from 'ohne';
import { isEmail } from 'ohne/utils';

import { normalizeEmail } from '../auth/_email.ts';

/**
 * The `Users` collection: an account identified by a unique email, with a scrypt password hash.
 *
 * The email is normalized to trimmed-lowercase before it is stored, so its uniqueness is case-insensitive.
 * `passwordHash` holds a `hashPassword` string, never a plaintext password; the auth routes fill it.
 */
export default defineCollection({
  fields: {
    email: field('text', {
      unique: true,
      sanitizers: [normalizeEmail],
      validators: [(value) => (isEmail(value) ? undefined : 'auth.invalidEmail')],
      label: 'auth.users.email.label',
      description: 'auth.users.email.description',
    }),

    passwordHash: field('text', {
      label: 'auth.users.passwordHash.label',
      description: 'auth.users.passwordHash.description',
    }),
  },
});
