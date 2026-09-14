import { defineCollection, field } from 'ohnejs';
import { isEmail } from 'ohnejs/utils';

import { normalizeEmail } from '../auth/_email.ts';

/**
 * The `Users` collection: an account identified by a unique email, with a scrypt password hash.
 *
 * The email is normalized to trimmed-lowercase before it is stored, so its uniqueness is case-insensitive.
 * `password` takes a plaintext password on write; the field type stores its scrypt hash, never the text.
 * The hash is write-only: no read returns it unless a trusted `select` names it explicitly.
 * `roles` holds the user's role names; the capabilities of every held role union.
 * The six fields after `roles` are the user's own dashboard settings, edited on the account page.
 * All six are nullable, so an existing table gains them without a migration.
 * `toUser` reads a `null` setting as its default.
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

    dashboardLanguage: field('language', {
      nullable: true,
      label: 'auth.users.dashboardLanguage.label',
      description: 'auth.users.dashboardLanguage.description',
    }),

    contentLanguage: field('locale', {
      nullable: true,
      label: 'auth.users.contentLanguage.label',
      description: 'auth.users.contentLanguage.description',
    }),

    timezone: field('timezone', {
      nullable: true,
      label: 'auth.users.timezone.label',
      description: 'auth.users.timezone.description',
    }),

    dateFormat: field('datePattern', {
      nullable: true,
      default: 'LL',
      placeholder: 'YYYY-MM-DD',
      label: 'auth.users.dateFormat.label',
      description: { text: 'auth.users.dateFormat.tokens' },
    }),

    timeFormat: field('datePattern', {
      nullable: true,
      default: 'LTS',
      placeholder: 'HH:mm:ss',
      label: 'auth.users.timeFormat.label',
      description: { text: 'auth.users.timeFormat.tokens' },
    }),

    smartClipboard: field('boolean', {
      nullable: true,
      default: false,
      display: 'switch',
      label: 'auth.users.smartClipboard.label',
      description: 'auth.users.smartClipboard.description',
    }),
  },
});

/**
 * The `Users` definition, for an app's own `collections/Users.ts` to spread and extend.
 * An override replaces the file whole, so spread this to keep the fields auth depends on.
 * The auth routes and helpers read `email`, `password`, and `roles`; keep all three.
 * The account page edits the six settings fields, `dashboardLanguage` through `smartClipboard`.
 * Spread all nine: a dropped settings field falls back to its default, so the dashboard degrades quietly.
 *
 * @example
 * ```ts
 * // collections/Users.ts
 * import { defineCollection, field } from 'ohnejs'
 * import { usersDefinition } from 'ohnejs/auth'
 *
 * export default defineCollection({
 *   ...usersDefinition,
 *   fields: { ...usersDefinition.fields, name: field('text') },
 * })
 * ```
 */
export const usersDefinition: typeof users = users;

export default users;
