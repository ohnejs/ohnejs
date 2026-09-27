import { defineCollection, field } from 'ohnejs';
import { isEmail } from 'ohnejs/utils';

import { normalizeEmail } from '../auth/_email.ts';
import { manageUsers } from '../auth/manage-users.ts';

/**
 * The `Users` collection: an account identified by a unique email, with a scrypt password hash.
 *
 * The email is normalized to trimmed-lowercase before it is stored, so its uniqueness is case-insensitive.
 * `password` takes a plaintext password on write; the field type stores its scrypt hash, never the text.
 * The hash is write-only: no read returns it unless a trusted `select` names it explicitly.
 * `firstName` and `lastName` name the person; both are optional.
 * `roles` holds the user's role names; the capabilities of every held role union.
 * The fields after `roles` are the user's own dashboard settings, edited on the account page.
 * Each is nullable, so an existing table gains them without a migration.
 * `toUser` reads a `null` name or setting as its default.
 * The `dashboard.layout` groups the editor into the same cards the account page shows.
 * The API is guarded by the `collection.Users.*` capabilities, and `manageUsers` scopes every write.
 * You can grant a role only when your own capabilities cover every capability it lists.
 * You can edit or delete a user only when you could grant every role they hold.
 */
const users = defineCollection({
  api: {
    read: {},
    create: { access: manageUsers },
    update: { access: manageUsers },
    delete: { access: manageUsers },
  },
  dashboard: {
    icon: 'users',
    layout: [
      { card: [{ row: ['email', 'password'] }, { row: ['firstName', 'lastName'] }] },
      { card: ['roles'] },
      { card: [{ row: ['contentLanguage', 'dashboardLanguage'] }] },
      { card: ['timezone', { row: ['dateFormat', 'timeFormat'] }] },
      { card: ['smartClipboard'] },
    ],
  },
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

    firstName: field('text', { nullable: true, label: 'auth.users.firstName.label' }),

    lastName: field('text', { nullable: true, label: 'auth.users.lastName.label' }),

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
      display: 'buttons',
      trueLabel: 'auth.users.smartClipboard.enabled',
      falseLabel: 'auth.users.smartClipboard.disabled',
      label: 'auth.users.smartClipboard.label',
      description: 'auth.users.smartClipboard.description',
    }),
  },
});

/**
 * The `Users` definition, for an app's own `collections/Users.ts` to spread and extend.
 * An override replaces the file whole, so spread this to keep the fields auth depends on.
 * Spreading it keeps the `manageUsers` grant rule.
 * An override that sets its own `api` drops the rule unless each write passes `access: manageUsers`.
 * The auth routes and helpers read `email`, `password`, and `roles`.
 * The account page edits the name and settings fields as `auth:account-layout` arranges them.
 * A dropped name or settings field falls back to its default, so the dashboard degrades quietly.
 * An added field renders after the layout's last card unless a `dashboard.layout` override places it.
 *
 * @example
 * ```ts
 * // collections/Users.ts
 * import { defineCollection, field } from 'ohnejs'
 * import { usersDefinition } from 'ohnejs/auth'
 *
 * export default defineCollection({
 *   ...usersDefinition,
 *   fields: {
 *     ...usersDefinition.fields,
 *     phone: field('text', { nullable: true }),
 *   },
 * })
 * ```
 */
export const usersDefinition: typeof users = users;

export default users;
