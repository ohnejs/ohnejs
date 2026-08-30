import { defineCollection, field } from 'ohne';
import { isEmail } from 'ohne/utils';

import { normalizeEmail } from '../auth/_email.ts';

/**
 * The `Users` collection: an account identified by a unique email, with a scrypt password hash.
 *
 * The email is normalized to trimmed-lowercase before it is stored, so its uniqueness is case-insensitive.
 * `password` takes a plaintext password on write; the field type stores its scrypt hash, never the text.
 * The hash is write-only: no read returns it unless a trusted `select` names it explicitly.
 * `roles` holds the user's role names; the capabilities of every held role union.
 * The API exposure is guarded, so user management needs the `collection.Users.*` capabilities.
 */
const users = defineCollection({
  api: true,
  dashboard: { icon: 'users' },
  fields: {
    email: field('text', {
      unique: true,
      sanitizers: [normalizeEmail],
      validators: [(value) => (isEmail(value) ? undefined : 'auth.invalidEmail')],
      label: 'auth.users.email.label',
      description: 'auth.users.email.description',
    }),

    password: field('password', {
      readable: false,
      label: 'auth.users.password.label',
      description: 'auth.users.password.description',
    }),

    roles: field('roles', {
      label: 'auth.users.roles.label',
      description: 'auth.users.roles.description',
    }),
  },
});

/**
 * The `Users` definition, for an app's own `collections/Users.ts` to spread and extend.
 * An override replaces the file whole, so spread this to keep the fields auth depends on.
 * The auth routes and helpers read `email`, `password`, and `roles`; keep all three.
 *
 * @example
 * ```ts
 * // collections/Users.ts
 * import { defineCollection, field } from 'ohne'
 * import { usersDefinition } from 'ohne/auth'
 *
 * export default defineCollection({
 *   ...usersDefinition,
 *   fields: { ...usersDefinition.fields, name: field('text') },
 * })
 * ```
 */
export const usersDefinition: typeof users = users;

export default users;
