import { defineCollection, field } from 'ohne';

/**
 * The `Sessions` collection: one live login, keyed by the hash of its opaque cookie token.
 *
 * The raw token lives only in the user's cookie; the row stores only its sha256.
 * A leaked database therefore cannot reconstruct a usable session.
 * `expiresAt` is epoch milliseconds; a session past it is treated as gone.
 * Deleting a user cascades to their sessions, so a removed account cannot leave a session behind.
 */
export default defineCollection({
  fields: {
    user: field('record', {
      collection: 'Users',
      onDelete: 'cascade',
      label: 'auth.sessions.user.label',
      description: 'auth.sessions.user.description',
    }),

    tokenHash: field('text', {
      unique: true,
      label: 'auth.sessions.tokenHash.label',
      description: 'auth.sessions.tokenHash.description',
    }),

    expiresAt: field('integer', {
      index: true,
      label: 'auth.sessions.expiresAt.label',
      description: 'auth.sessions.expiresAt.description',
    }),
  },
});
