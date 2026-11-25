import { defineCollection, field } from 'ohnejs';

/**
 * The `Passkeys` collection: one WebAuthn credential a user signs in with.
 *
 * `credentialID` names the credential as the browser sends it, base64url.
 * `publicKey` is the credential's public key as a JWK; it verifies every sign-in signature.
 * `signCount` is the highest signature counter seen, to spot a cloned authenticator.
 * Synced passkeys always count `0`, so they never trip it.
 * `backupEligible` and `backedUp` tell a synced passkey from one bound to a single device.
 * Deleting a user cascades to their passkeys.
 * The collection has no API: the `/auth/passkey` routes list, rename and remove a user's own.
 */
const passkeys = defineCollection({
  label: 'auth.passkeys.label',
  dashboard: { icon: 'fingerprint' },
  fields: {
    user: field('record', {
      collection: 'Users',
      onDelete: 'cascade',
      label: 'auth.passkeys.user.label',
    }),

    name: field('text', { label: 'auth.passkeys.name.label' }),

    credentialID: field('text', { unique: true, label: 'auth.passkeys.credentialID.label' }),

    publicKey: field('json', { readable: false, label: 'auth.passkeys.publicKey.label' }),

    signCount: field('integer', { default: 0, label: 'auth.passkeys.signCount.label' }),

    transports: field('json', { default: [], label: 'auth.passkeys.transports.label' }),

    backupEligible: field('boolean', {
      default: false,
      label: 'auth.passkeys.backupEligible.label',
    }),

    backedUp: field('boolean', { default: false, label: 'auth.passkeys.backedUp.label' }),

    createdAt: field('dateTime', { label: 'auth.passkeys.createdAt.label' }),

    lastUsedAt: field('dateTime', { nullable: true, label: 'auth.passkeys.lastUsedAt.label' }),
  },
});

/**
 * The `Passkeys` definition, for an app's own `collections/Passkeys.ts` to spread.
 * An override replaces the file whole, so spread this to keep the fields passkey sign-in depends on.
 *
 * @example
 * ```ts
 * // collections/Passkeys.ts
 * import { defineCollection } from 'ohnejs'
 * import { passkeysDefinition } from 'ohnejs/auth'
 *
 * export default defineCollection({ ...passkeysDefinition, api: { read: {} } })
 * ```
 */
export const passkeysDefinition: typeof passkeys = passkeys;

export default passkeys;
