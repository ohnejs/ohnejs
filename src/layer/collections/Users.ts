import { defineCollection, field } from 'ohne';
import { isEmail } from 'ohne/utils';

import { normalizeEmail } from '../auth/_email.ts';

/**
 * The `Users` collection: an account identified by a unique email, with a scrypt password hash.
 *
 * The email is normalized to trimmed-lowercase before it is stored, so its uniqueness is case-insensitive.
 * `password` takes a plaintext password on write; the field type stores its scrypt hash, never the text.
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

    password: field('password', {
      label: 'auth.users.password.label',
      description: 'auth.users.password.description',
    }),
  },
});
