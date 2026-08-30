import type { AccessScope } from 'ohne';

import { defineCollection, field } from 'ohne';
import { isNull } from 'ohne/utils';

import { useUser } from '../auth/use-user.ts';

/**
 * Scopes an exposed operation to the caller's own sessions.
 * An anonymous caller is refused as the identical `404`, so the endpoint reveals nothing.
 */
const ownSessions = async (): Promise<AccessScope<'expiresAt' | 'tokenHash' | 'user'> | false> => {
  const user = await useUser();
  return isNull(user) ? false : { where: { user: user.UUID } };
};

/**
 * The `Sessions` collection: one live login, keyed by the hash of its opaque cookie token.
 *
 * The raw token lives only in the user's cookie; the row stores only its sha256.
 * A leaked database therefore cannot reconstruct a usable session.
 * The hash is `readable: false`, so no read returns it unless a trusted `select` names it explicitly.
 * `expiresAt` is epoch milliseconds; a session past it is treated as gone.
 * Deleting a user cascades to their sessions, so a removed account cannot leave a session behind.
 * The API exposes `read` and `delete` to the session's own user alone, scoped by `access`.
 * A signed-in user therefore lists and revokes only their own sessions.
 */
export default defineCollection({
  api: {
    read: { public: true, access: ownSessions },
    delete: { public: true, access: ownSessions },
  },
  dashboard: { icon: 'key' },
  fields: {
    user: field('record', {
      collection: 'Users',
      onDelete: 'cascade',
      label: 'auth.sessions.user.label',
      description: 'auth.sessions.user.description',
    }),

    tokenHash: field('text', {
      unique: true,
      readable: false,
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
